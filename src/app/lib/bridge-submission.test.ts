import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EvmProvider } from "../../wallets/evm/evm-wallet";
import { SEPOLIA_NETWORK } from "../../config/sepolia";
import { AGGLAYER_BALI } from "../../bridge/providers/agglayer/agglayer";
import { runAgglayerSend } from "../../bridge/providers/agglayer/agglayer-execute";
import { runEpochTransfer, type EpochExecuteResult } from "../../bridge/providers/epoch/epoch-execute";
import { loadStoredActivities, saveActivities } from "./bridge-persistence";
import type { Activity } from "./bridge-presentation";
import { submitBridgeTransfer, type TransferSubmission } from "./bridge-submission";

vi.mock("../../bridge/providers/agglayer/agglayer-execute", () => ({ runAgglayerSend: vi.fn() }));
vi.mock("../../bridge/providers/epoch/epoch-execute", () => ({ runEpochTransfer: vi.fn() }));

const EVM_ADDRESS = "0x1111111111111111111111111111111111111111";
const MIDEN_ACCOUNT = "0x387149ae66116cf114eebd60bb7381";
const TX_HASH = `0x${"ab".repeat(32)}`;
const history: Activity = {
  id: "existing",
  mode: "receive",
  provider: "epoch",
  status: "complete",
  amount: "1",
  asset: "USDC",
  summary: "Receive 1 USDC on Miden",
  eta: "1-3 min",
  txHash: TX_HASH,
  updatedAt: 1_700_000_000_000,
};

beforeEach(() => {
  vi.resetAllMocks();
  const storage = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
  saveActivities([history]);
});

afterEach(() => vi.unstubAllGlobals());

function setup(overrides: Partial<TransferSubmission> = {}) {
  const evmRequest = vi.fn<EvmProvider["request"]>().mockResolvedValue(SEPOLIA_NETWORK.chainHex);
  const input: TransferSubmission = {
    routeId: "epoch-usdc-to-miden",
    amount: "0.12345678",
    destination: "",
    activities: [history],
    insufficientBalance: false,
    evmBalance: "1 USDC",
    evmWallet: {
      connected: true,
      address: EVM_ADDRESS,
      provider: { request: evmRequest as EvmProvider["request"] },
    },
    midenWallet: {
      connected: true,
      address: MIDEN_ACCOUNT,
      requestTransaction: vi.fn(),
      waitForTransaction: vi.fn(),
    },
    agglayerEth: { faucetId: MIDEN_ACCOUNT, decimals: 8, amountRaw: 100_000_000n, symbol: "ETH" },
    epochEvmAddress: EVM_ADDRESS,
    epochMidenAccount: MIDEN_ACCOUNT,
    ...overrides,
  };
  const effects = {
    openEvmWallet: vi.fn(async () => {}),
    onError: vi.fn(),
    onSubmittingChange: vi.fn(),
    onPhaseChange: vi.fn(),
    onActivitiesChange: vi.fn(),
    navigate: vi.fn(),
  };
  return { input, effects, evmRequest };
}

describe("submission validation", () => {
  it.each([
    ["disabled route", { routeId: "near-intents" }, /isn't available/],
    ["insufficient balance", { insufficientBalance: true }, /Not enough USDC/],
    ["disconnected Miden source", { routeId: "epoch-usdc-to-sepolia", midenWallet: { connected: false, address: "" } }, /Connect your Bread wallet/],
    ["missing Miden signing methods", { routeId: "agglayer-eth-to-sepolia", midenWallet: { connected: true, address: MIDEN_ACCOUNT } }, /Connect your Bread wallet/],
    ["invalid Agglayer recipient", { routeId: "agglayer-eth-to-sepolia", destination: "invalid" }, /valid Sepolia/],
    ["unresolved Agglayer asset", { routeId: "agglayer-eth-to-sepolia", agglayerEth: null }, /Show balance/],
    ["malformed Agglayer amount", { routeId: "agglayer-eth-to-sepolia", amount: "1.2.3" }, /valid amount/],
    ["zero Agglayer amount", { routeId: "agglayer-eth-to-sepolia", amount: "0" }, /greater than zero/],
    ["missing Agglayer recipient", { routeId: "agglayer-eth-to-miden", midenWallet: { connected: false, address: "" } }, /paste a Miden account/],
    ["missing Epoch recipient", { epochMidenAccount: "" }, /paste a Miden account/],
    ["invalid Epoch recipient", { routeId: "epoch-usdc-to-sepolia", epochEvmAddress: "invalid" }, /valid Sepolia/],
  ] satisfies Array<[string, Partial<TransferSubmission>, RegExp]>)("rejects %s before signing or creating an activity", async (_name, overrides, message) => {
    const { input, effects, evmRequest } = setup(overrides);
    await submitBridgeTransfer(input, effects);

    expect(effects.onError).toHaveBeenCalledWith(expect.stringMatching(message));
    expect(runEpochTransfer).not.toHaveBeenCalled();
    expect(runAgglayerSend).not.toHaveBeenCalled();
    expect(evmRequest.mock.calls.some(([request]) => request.method === "eth_sendTransaction")).toBe(false);
    expect(loadStoredActivities()).toEqual([history]);
    expect(effects.navigate).not.toHaveBeenCalled();
    expect(effects.onSubmittingChange.mock.lastCall?.[0] ?? false).toBe(false);
  });

  it.each(["epoch", "agglayer"] as const)("requests the EVM connection for a disconnected %s receive", async (provider) => {
    const { input, effects } = setup({ routeId: provider === "epoch" ? "epoch-usdc-to-miden" : "agglayer-eth-to-miden", evmWallet: { connected: false, address: "" } });
    await submitBridgeTransfer(input, effects);

    expect(effects.openEvmWallet).toHaveBeenCalledOnce();
    expect(effects.onSubmittingChange).toHaveBeenLastCalledWith(false);
    expect(runEpochTransfer).not.toHaveBeenCalled();
    expect(loadStoredActivities()).toEqual([history]);
  });
});

describe("Agglayer submission", () => {
  it("converts the resolved asset's amount and records the on-chain hash only after the send succeeds", async () => {
    const started = Promise.withResolvers<void>();
    const execution = Promise.withResolvers<{ txId: string; txHash: string }>();
    vi.mocked(runAgglayerSend).mockImplementation(() => {
      started.resolve();
      return execution.promise;
    });
    const { input, effects } = setup({ routeId: "agglayer-eth-to-sepolia" });
    const submission = submitBridgeTransfer(input, effects);
    await started.promise;

    expect(loadStoredActivities()).toEqual([history]);
    expect(effects.navigate).not.toHaveBeenCalled();
    expect(runAgglayerSend).toHaveBeenCalledWith(expect.objectContaining({
      amount: 12_345_678n,
      faucetId: MIDEN_ACCOUNT,
      destinationAddress: EVM_ADDRESS,
      senderAddress: MIDEN_ACCOUNT,
    }));
    expect(effects.onPhaseChange).toHaveBeenLastCalledWith("Confirm in your wallet…");

    execution.resolve({ txId: "wallet-request-uuid", txHash: TX_HASH });
    await submission;

    const [activity, older] = loadStoredActivities();
    expect(activity).toMatchObject({
      provider: "agglayer", mode: "send", status: "source_finality",
      destination: EVM_ADDRESS, midenTxId: TX_HASH,
      sourceNetworkId: AGGLAYER_BALI.destinationNetworkId,
      destinationNetworkId: AGGLAYER_BALI.sourceNetworkId,
    });
    expect(older).toEqual(history);
    expect(effects.navigate).toHaveBeenCalledWith(`/activity/${activity.id}`);
    expect(effects.onSubmittingChange).toHaveBeenLastCalledWith(false);
    expect(effects.onPhaseChange).toHaveBeenLastCalledWith("");
  });

  it("preserves history and clears progress when the Sepolia deposit is rejected", async () => {
    const { input, effects, evmRequest } = setup({ routeId: "agglayer-eth-to-miden" });
    evmRequest.mockResolvedValueOnce(SEPOLIA_NETWORK.chainHex).mockRejectedValueOnce({ code: 4001 });
    await submitBridgeTransfer(input, effects);

    expect(evmRequest).toHaveBeenLastCalledWith(expect.objectContaining({ method: "eth_sendTransaction" }));
    expect(loadStoredActivities()).toEqual([history]);
    expect(effects.navigate).not.toHaveBeenCalled();
    expect(effects.onError).toHaveBeenCalledWith("You cancelled the request in your wallet.");
    expect(effects.onSubmittingChange).toHaveBeenLastCalledWith(false);
    expect(effects.onPhaseChange).toHaveBeenLastCalledWith("");
  });
});

describe("Epoch activity lifecycle", () => {
  it("persists before navigation and execution, then saves progress and final tracking data", async () => {
    const started = Promise.withResolvers<void>();
    const execution = Promise.withResolvers<EpochExecuteResult>();
    const { input, effects } = setup();
    effects.navigate.mockImplementation((path: string) => {
      expect(path).toBe(`/activity/${loadStoredActivities()[0].id}`);
    });
    vi.mocked(runEpochTransfer).mockImplementation(() => {
      expect(effects.navigate).toHaveBeenCalledOnce();
      started.resolve();
      return execution.promise;
    });
    const submission = submitBridgeTransfer(input, effects);
    await started.promise;

    const [optimistic] = loadStoredActivities();
    expect(optimistic).toMatchObject({
      provider: "epoch", status: "source_finality", destination: MIDEN_ACCOUNT,
      midenAccountHex: MIDEN_ACCOUNT, epochSponsor: EVM_ADDRESS,
    });
    const { onStatus } = vi.mocked(runEpochTransfer).mock.calls[0][0];
    const progress = { transactionIndex: 0, totalTransactions: 1, chainId: SEPOLIA_NETWORK.chainId };
    onStatus!({ ...progress, phase: "sending", transactionHash: "0xab…cd" });
    expect(loadStoredActivities()[0]).toMatchObject({ status: "source_finality", eta: "Confirm the deposit in your wallet…" });
    expect(loadStoredActivities()[0].sourceTxHash).toBeUndefined();
    onStatus!({ ...progress, phase: "sent", transactionHash: TX_HASH });
    expect(loadStoredActivities()[0]).toMatchObject({ status: "message_observed", sourceTxHash: TX_HASH });

    execution.resolve({
      direction: "receive", intentNonce: "42", sponsorAddress: EVM_ADDRESS,
      sourceTxHash: TX_HASH, outputAmount: "0.123456789012345678",
      raw: { taskTypeString: "test", intentData: {} },
    });
    await submission;

    expect(loadStoredActivities()[0]).toMatchObject({
      id: optimistic.id, status: "message_observed", eta: "1-3 min",
      epochIntentNonce: "42", epochSponsor: EVM_ADDRESS,
      sourceTxHash: TX_HASH, receivedAmount: "0.123456789012345678",
    });
    expect(effects.onActivitiesChange).toHaveBeenLastCalledWith(loadStoredActivities());
    expect(effects.onSubmittingChange).toHaveBeenLastCalledWith(false);
    expect(effects.onPhaseChange).toHaveBeenLastCalledWith("");
  });

  it.each([{ code: 4001 }, new Error("ACTION_REJECTED"), new Error("User denied transaction")])("removes only its optimistic activity on wallet rejection (%s)", async (error) => {
    const { input, effects } = setup();
    const other = { ...history, id: "created-while-submitting" };
    vi.mocked(runEpochTransfer).mockImplementation(async () => {
      saveActivities([...loadStoredActivities(), other]);
      throw error;
    });
    await submitBridgeTransfer(input, effects);

    expect(loadStoredActivities()).toEqual([history, other]);
    expect(effects.navigate).toHaveBeenLastCalledWith("/");
    expect(effects.onError).toHaveBeenCalledWith("You cancelled the request in your wallet.");
    expect(effects.onSubmittingChange).toHaveBeenLastCalledWith(false);
    expect(effects.onPhaseChange).toHaveBeenLastCalledWith("");
  });

  it("keeps a failed activity and its broadcast hash available for recovery", async () => {
    const { input, effects } = setup();
    vi.mocked(runEpochTransfer).mockImplementation(async ({ onStatus }) => {
      onStatus!({ phase: "sent", transactionIndex: 0, totalTransactions: 1, chainId: SEPOLIA_NETWORK.chainId, transactionHash: TX_HASH });
      throw new Error("Solver unavailable");
    });
    await submitBridgeTransfer(input, effects);

    const [failed, older] = loadStoredActivities();
    expect(failed).toMatchObject({ status: "failed", eta: "Transfer failed", sourceTxHash: TX_HASH, epochSponsor: EVM_ADDRESS });
    expect(older).toEqual(history);
    expect(effects.navigate).toHaveBeenCalledOnce();
    expect(effects.onError).toHaveBeenCalledWith("Solver unavailable");
    expect(effects.onSubmittingChange).toHaveBeenLastCalledWith(false);
    expect(effects.onPhaseChange).toHaveBeenLastCalledWith("");
  });
});
