import { fetchWithdrawalQuote } from "../../bridge/providers/xreserve/withdrawal-quote";
import { withdrawUsdcx } from "../../bridge/providers/xreserve/withdrawal-execute";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findBridgeRoute } from "../../bridge/core/routes";
import type { EvmProvider } from "../../wallets/evm/evm-wallet";
import { SEPOLIA_NETWORK } from "../../config/sepolia";
import { runAgglayerSend } from "../../bridge/providers/agglayer/agglayer-execute";
import { runEpochTransfer, type EpochExecuteResult } from "../../bridge/providers/epoch/epoch-execute";
import { captureSourceTransaction } from "../../bridge/evm/source-transaction";
import { depositOnArc } from "../../bridge/providers/xreserve/deposit";
import { loadStoredActivities, saveActivities } from "./bridge-persistence";
import type { Activity } from "./bridge-presentation";
import { submitBridgeTransfer, type TransferSubmission } from "./bridge-submission";

vi.mock("../../bridge/providers/xreserve/withdrawal-quote", () => ({ fetchWithdrawalQuote: vi.fn() }));
vi.mock("../../bridge/providers/xreserve/withdrawal-execute", () => ({ withdrawUsdcx: vi.fn() }));
vi.mock("../../bridge/evm/source-transaction", () => ({ captureSourceTransaction: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../bridge/providers/xreserve/deposit", () => ({ depositOnArc: vi.fn() }));
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
  vi.mocked(captureSourceTransaction).mockResolvedValue(undefined);
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
    routeId: "epoch-test-usdc-to-miden",
    amount: "0.123456",
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
    midenAsset: { faucetId: MIDEN_ACCOUNT, decimals: 8, amountRaw: 100_000_000n, symbol: "ETH" },
    evmAddress: EVM_ADDRESS,
    midenAccount: MIDEN_ACCOUNT,
    ...overrides,
  };
  if (findBridgeRoute(input.routeId)?.provider === "epoch" && !("quote" in overrides)) {
    input.quote = {
      kind: "epoch", received: "0.12", expiresAt: Date.now() + 60_000,
      request: { routeId: input.routeId, amount: input.amount, evmAddress: input.evmAddress, midenAccount: input.midenAccount },
    };
  }
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
  it.each(["missing", "expired", "amount", "routeId", "midenAccount", "evmAddress"] as const)(
    "requires another review when the quote is %s", async (change) => {
      const { input, effects } = setup();
      if (change === "missing") input.quote = undefined;
      else if (change === "expired") input.quote!.expiresAt = Date.now() - 1;
      else input.quote!.request[change] = "changed";
      await submitBridgeTransfer(input, effects);
      expect(runEpochTransfer).not.toHaveBeenCalled();
      expect(loadStoredActivities()).toEqual([history]);
      expect(effects.onError).toHaveBeenCalledWith(expect.stringMatching(/review.*quote/i));
    },
  );

  it.each([
    ["unknown route", { routeId: "unknown-route" }, /isn't available/],
    ["retired Epoch faucet", { routeId: "epoch-usdc-to-miden" }, /isn't available/],
    ["insufficient balance", { insufficientBalance: true }, /Not enough USDC/],
    ["disconnected Miden source", { routeId: "epoch-test-usdc-to-sepolia", midenWallet: { connected: false, address: "" } }, /Connect your Bread wallet/],
    ["disconnected Miden destination with a stale address", { routeId: "agglayer-eth-to-miden", midenWallet: { connected: false, address: MIDEN_ACCOUNT } }, /Connect your Bread wallet/],
    ["Miden recipient differs from the connected wallet", { midenAccount: "0x4e6fb40fd2f6a55140df2c42dfb5b7" }, /wallet changed.*review/i],
    ["EVM recipient differs from the connected wallet", { routeId: "epoch-test-usdc-to-sepolia", evmAddress: `0x${"22".repeat(20)}` }, /wallet changed.*review/i],
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

  it.each(["epoch-test-usdc-to-miden", "agglayer-eth-to-miden", "epoch-test-usdc-to-sepolia"])("requests the EVM connection for a disconnected source or destination on %s", async (routeId) => {
    const { input, effects } = setup({ routeId, evmWallet: { connected: false, address: EVM_ADDRESS } });
    await submitBridgeTransfer(input, effects);

    expect(effects.openEvmWallet).toHaveBeenCalledOnce();
    expect(effects.onSubmittingChange).toHaveBeenLastCalledWith(false);
    expect(runEpochTransfer).not.toHaveBeenCalled();
    expect(loadStoredActivities()).toEqual([history]);
  });
});

describe("Agglayer submission", () => {
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
  it("persists the acknowledged submission before navigation, then saves solver tracking data", async () => {
    const started = Promise.withResolvers<void>();
    const execution = Promise.withResolvers<EpochExecuteResult>();
    const { input, effects } = setup();
    effects.navigate.mockImplementation((path: string) => {
      expect(path).toBe(`/activity/${loadStoredActivities()[0].id}`);
    });
    vi.mocked(runEpochTransfer).mockImplementation(() => {
      expect(effects.navigate).not.toHaveBeenCalled();
      started.resolve();
      return execution.promise;
    });
    const submission = submitBridgeTransfer(input, effects);
    await started.promise;

    expect(loadStoredActivities()).toEqual([history]);
    const { onStatus, onSubmitted } = vi.mocked(runEpochTransfer).mock.calls[0][0];
    const progress = { transactionIndex: 0, totalTransactions: 1, chainId: SEPOLIA_NETWORK.chainId };
    onStatus!({ ...progress, phase: "sending" });
    expect(loadStoredActivities()).toEqual([history]);
    expect(effects.onPhaseChange).toHaveBeenLastCalledWith("Confirm the deposit in your wallet…");
    onSubmitted!({ sourceTxHash: TX_HASH });
    const [submitted] = loadStoredActivities();
    expect(submitted).toMatchObject({ provider: "epoch", status: "source_finality", sourceTxHash: TX_HASH, destination: MIDEN_ACCOUNT });

    execution.resolve({
      direction: "receive", intentNonce: "42", sponsorAddress: EVM_ADDRESS,
      sourceTxHash: TX_HASH, outputAmount: "0.123456789012345678",
      raw: { taskTypeString: "test", intentData: {} },
    });
    await submission;

    expect(loadStoredActivities()[0]).toMatchObject({
      id: submitted.id, status: "message_observed", eta: "1-3 min",
      epochIntentNonce: "42", epochSponsor: EVM_ADDRESS,
      sourceTxHash: TX_HASH, receivedAmount: "0.123456789012345678",
    });
    expect(effects.onActivitiesChange).toHaveBeenLastCalledWith(loadStoredActivities());
    expect(effects.onSubmittingChange).toHaveBeenLastCalledWith(false);
    expect(effects.onPhaseChange).toHaveBeenLastCalledWith("");
  });

  it.each([{ code: 4001 }, new Error("ACTION_REJECTED"), new Error("User denied transaction")])("leaves history untouched on wallet rejection (%s)", async (error) => {
    const { input, effects } = setup();
    const other = { ...history, id: "created-while-submitting" };
    vi.mocked(runEpochTransfer).mockImplementation(async () => {
      saveActivities([...loadStoredActivities(), other]);
      throw error;
    });
    await submitBridgeTransfer(input, effects);

    expect(loadStoredActivities()).toEqual([history, other]);
    expect(effects.navigate).not.toHaveBeenCalled();
    expect(effects.onError).toHaveBeenCalledWith("You cancelled the request in your wallet.");
    expect(effects.onSubmittingChange).toHaveBeenLastCalledWith(false);
    expect(effects.onPhaseChange).toHaveBeenLastCalledWith("");
  });

  it("keeps a broadcast transfer pending when the solver becomes unavailable", async () => {
    const { input, effects } = setup();
    vi.mocked(runEpochTransfer).mockImplementation(async ({ onSubmitted }) => {
      onSubmitted!({ sourceTxHash: TX_HASH });
      throw new Error("Solver unavailable");
    });
    await submitBridgeTransfer(input, effects);

    const [failed, older] = loadStoredActivities();
    expect(failed).toMatchObject({ status: "source_finality", sourceTxHash: TX_HASH, epochSponsor: EVM_ADDRESS });
    expect(older).toEqual(history);
    expect(effects.navigate).toHaveBeenCalledOnce();
    expect(effects.onError).toHaveBeenCalledWith(expect.stringContaining("do not submit again"));
    expect(effects.onSubmittingChange).toHaveBeenLastCalledWith(false);
    expect(effects.onPhaseChange).toHaveBeenLastCalledWith("");
  });
});

describe("USDCx submission", () => {
  it("saves the actual source nonce after broadcast without overwriting a concurrent activity update", async () => {
    const { input, effects } = setup({ routeId: "xreserve-usdc-to-miden", amount: "1" });
    const transaction = { hash: TX_HASH, from: EVM_ADDRESS, nonce: 7, to: EVM_ADDRESS, input: "0x1234", value: "0" };
    let resolve!: (value: typeof transaction) => void;
    vi.mocked(captureSourceTransaction).mockReturnValue(new Promise((done) => { resolve = done; }));
    vi.mocked(depositOnArc).mockImplementation(async ({ onBroadcast }) => {
      onBroadcast(TX_HASH as `0x${string}`);
      return TX_HASH as `0x${string}`;
    });
    await submitBridgeTransfer(input, effects);
    expect(effects.navigate).toHaveBeenCalledOnce();
    const stored = loadStoredActivities();
    saveActivities([{ ...stored[0], xreserveStatus: "confirmed" }, history]);
    resolve(transaction);
    await vi.waitFor(() => expect(loadStoredActivities()[0]).toMatchObject({
      sourceTransaction: transaction, xreserveStatus: "confirmed", sourceTxHash: TX_HASH,
    }));
    expect(loadStoredActivities()[1]).toEqual(history);
  });

  it("persists the broadcast before navigating and retains it after a later failure", async () => {
    const { input, effects } = setup({ routeId: "xreserve-usdc-to-miden", amount: "1.000001" });
    vi.mocked(depositOnArc).mockImplementation(async ({ onBroadcast }) => {
      expect(loadStoredActivities()).toEqual([history]);
      onBroadcast(TX_HASH as `0x${string}`);
      throw new Error("connection lost after broadcast");
    });
    effects.navigate.mockImplementation(async () => {
      expect(loadStoredActivities()[0]).toMatchObject({ provider: "xreserve", status: "source_finality", sourceTxHash: TX_HASH, receivedAmount: "1.000001", evmAddress: EVM_ADDRESS });
    });
    await submitBridgeTransfer(input, effects);
    expect(loadStoredActivities()).toHaveLength(2);
    expect(loadStoredActivities()[0].status).toBe("source_finality");
    expect(effects.navigate).toHaveBeenCalledOnce();
    expect(effects.onError).toHaveBeenCalledWith(expect.stringContaining("do not submit again"));
  });
  it("creates no activity for a rejected approval", async () => {
    const { input, effects } = setup({ routeId: "xreserve-usdc-to-miden", amount: "1" });
    vi.mocked(depositOnArc).mockRejectedValue(new Error("User rejected request"));
    await submitBridgeTransfer(input, effects);
    expect(loadStoredActivities()).toEqual([history]);
    expect(effects.navigate).not.toHaveBeenCalled();
    expect(effects.onSubmittingChange).toHaveBeenLastCalledWith(false);
  });
});


describe("USDCx withdrawal submission", () => {
  const estimate = () => ({ network: "arc-testnet" as const, amount: "2", sender: MIDEN_ACCOUNT, recipient: EVM_ADDRESS, fee: "16400", received: "1983600", expiresAt: Date.now() + 60000 });
  const reviewedQuote = () => ({
    kind: "withdrawal" as const, received: "1.9836", fee: "0.0164", expiresAt: Date.now() + 60_000, authorization: estimate(),
    request: { routeId: "xreserve-usdc-to-arc", amount: "2", evmAddress: EVM_ADDRESS, midenAccount: MIDEN_ACCOUNT },
  });
  beforeEach(() => vi.mocked(fetchWithdrawalQuote).mockResolvedValue(estimate()));
  it.each([false, true])("retains the burn note across wallet settlement (failure: %s)", async (fails) => {
    const { input, effects, evmRequest } = setup({
      routeId: "xreserve-usdc-to-arc", amount: "2", evmAddress: EVM_ADDRESS, quote: reviewedQuote(),
      evmWallet: { connected: true, address: EVM_ADDRESS },
    });
    const noteId = `0x${"cd".repeat(32)}`;
    vi.mocked(withdrawUsdcx).mockImplementation(async ({ onSubmitted }) => {
      onSubmitted(noteId, "wallet-request-id");
      expect(loadStoredActivities()[0]).toMatchObject({ xreserveNoteId: noteId, status: "source_finality" });
      if (fails) throw new Error("wallet settlement timed out");
      return { noteId, txHash: TX_HASH };
    });
    await submitBridgeTransfer(input, effects);
    expect(loadStoredActivities()[0]).toMatchObject({
      mode: "send", xreserveNoteId: noteId, destination: EVM_ADDRESS,
      xreserveWalletRequestId: "wallet-request-id", status: "source_finality",
    });
    expect(loadStoredActivities()[0].sourceTxHash).toBe(fails ? undefined : TX_HASH);
    expect(effects.navigate).toHaveBeenCalledOnce();
    expect(effects.openEvmWallet).not.toHaveBeenCalled();
    expect(evmRequest).not.toHaveBeenCalled();
    if (fails) expect(effects.onError).toHaveBeenCalledWith(expect.stringContaining("do not submit again"));
  });
  it("requires another review when Circle increases the fee before signing", async () => {
    const { input, effects } = setup({ routeId: "xreserve-usdc-to-arc", amount: "2", quote: reviewedQuote() });
    vi.mocked(fetchWithdrawalQuote).mockResolvedValue({ ...estimate(), fee: "20000", received: "1980000" });
    await submitBridgeTransfer(input, effects);
    expect(withdrawUsdcx).not.toHaveBeenCalled();
    expect(loadStoredActivities()).toEqual([history]);
    expect(effects.onError).toHaveBeenCalledWith(expect.stringContaining("fee increased"));
  });
  it("leaves no withdrawal activity after a rejected signature", async () => {
    const { input, effects } = setup({ routeId: "xreserve-usdc-to-arc", amount: "2", quote: reviewedQuote() });
    vi.mocked(withdrawUsdcx).mockRejectedValue(new Error("User rejected request"));
    await submitBridgeTransfer(input, effects);
    expect(loadStoredActivities()).toEqual([history]);
    expect(effects.navigate).not.toHaveBeenCalled();
  });
});
