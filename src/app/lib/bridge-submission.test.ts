import { fetchWithdrawalQuote, type WithdrawalQuote } from "../../bridge/providers/xreserve/withdrawal-quote";
import { withdrawUsdcx } from "../../bridge/providers/xreserve/withdrawal-execute";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, parseAbi } from "viem";
import { findBridgeRoute, routesForEnvironment } from "../../bridge/core/routes";
import type { EvmProvider } from "../../wallets/evm/evm-wallet";
import { SEPOLIA_NETWORK } from "../../config/sepolia";
import { runAgglayerSend } from "../../bridge/providers/agglayer/agglayer-execute";
import { runEpochTransfer, type EpochExecuteResult } from "../../bridge/providers/epoch/epoch-execute";
import { captureSourceTransaction, type SourceTransaction } from "../../bridge/evm/source-transaction";
import { depositOnArc } from "../../bridge/providers/xreserve/deposit";
import { depositViaCctp } from "../../bridge/providers/xreserve/cctp-deposit";
import { loadStoredActivities, saveActivities } from "./bridge-persistence";
import type { Activity } from "./bridge-presentation";
import { submitBridgeTransfer, type TransferSubmission } from "./bridge-submission";

vi.mock("../../bridge/providers/xreserve/withdrawal-quote", () => ({ fetchWithdrawalQuote: vi.fn() }));
vi.mock("../../bridge/providers/xreserve/withdrawal-execute", () => ({ withdrawUsdcx: vi.fn() }));
vi.mock("../../bridge/evm/source-transaction", () => ({ captureSourceTransaction: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../bridge/providers/xreserve/deposit", () => ({ depositOnArc: vi.fn() }));
vi.mock("../../bridge/providers/xreserve/cctp-deposit", () => ({ depositViaCctp: vi.fn() }));
vi.mock("../../bridge/providers/agglayer/agglayer-execute", () => ({ runAgglayerSend: vi.fn() }));
vi.mock("../../bridge/providers/epoch/epoch-execute", () => ({ runEpochTransfer: vi.fn() }));
const { tokenRpc, allowance } = vi.hoisted(() => ({
  tokenRpc: { readContract: vi.fn(), call: vi.fn(), estimateGas: vi.fn(), waitForTransactionReceipt: vi.fn() },
  allowance: vi.fn(),
}));
vi.mock("viem", async (importOriginal) => ({
  ...await importOriginal<typeof import("viem")>(),
  createPublicClient: () => tokenRpc,
}));

const EVM_ADDRESS = "0x1111111111111111111111111111111111111111";
const MIDEN_ACCOUNT = "0x387149ae66116cf114eebd60bb7381";
const TX_HASH = `0x${"ab".repeat(32)}` as const;
const history: Activity = {
  routeSnapshot: findBridgeRoute("epoch-test-usdc-to-miden")!, environment: "testnet",
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
      removeItem: (key: string) => storage.delete(key),
    },
  });
  saveActivities([history]);
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function setup(overrides: Partial<TransferSubmission> = {}) {
  const evmRequest = vi.fn<EvmProvider["request"]>().mockImplementation(async ({ method }) => method === "eth_accounts" ? [EVM_ADDRESS] : SEPOLIA_NETWORK.chainHex);
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
    midenAsset: { faucetId: "0x7c6d1dc7fb7045913d524bbef017f5", decimals: 8, amountRaw: 100_000_000n, symbol: "ETH" },
    evmAddress: EVM_ADDRESS,
    midenAccount: MIDEN_ACCOUNT,
    ...overrides,
  };
  if (findBridgeRoute(input.routeId)?.provider === "epoch" && !("quote" in overrides)) {
    input.quote = {
      kind: "epoch", received: "0.12", validity: { kind: "time", expiresAt: Date.now() + 60_000 },
      request: { recovery: findBridgeRoute(input.routeId)?.recovery, routeId: input.routeId, amount: input.amount, evmAddress: input.evmAddress, midenAccount: input.midenAccount },
    };
  }
  const effects = {
    openEvmWallet: vi.fn(async () => {}),
    verifyBalanceCap: vi.fn(async () => {}),
    onError: vi.fn(),
    onSubmittingChange: vi.fn(),
    onPhaseChange: vi.fn(),
    onActivitiesChange: vi.fn(),
    navigate: vi.fn(),
  };
  return { input, effects, evmRequest };
}

function setupCctp() {
  const route = findBridgeRoute("xreserve-sepolia-usdc-to-miden")!;
  // This estimate can pass while the source block limit remains authoritative.
  const expiresAt = Date.now() - 60_000;
  const authorization = {
    recovery: route.recovery, network: "sepolia" as const,
    sender: EVM_ADDRESS as `0x${string}`, recipient: MIDEN_ACCOUNT, amount: "1",
    signedQuote: "0x1234" as const, fee: "250000",
    issuedAt: Math.floor(expiresAt / 1000) - 168,
    expiry: { mode: "BLOCK_NUMBER" as const, expiresAtBlock: 26247476, blockEstimatedAt: Math.floor(expiresAt / 1000) },
  };
  return setup({
    routeId: route.id, amount: "1",
    quote: {
      kind: "cctp", received: "1", fee: "0.25", validity: { kind: "provider" }, authorization,
      request: { recovery: route.recovery, routeId: route.id, amount: "1", evmAddress: EVM_ADDRESS, midenAccount: MIDEN_ACCOUNT },
    },
  });
}

describe("submission validation", () => {
  it.each([true, false])("waits for a fresh balance-cap check before any deposit wallet call (allowed: %s)", async (allowed) => {
    const { input, effects, evmRequest } = setup({ routeId: "agglayer-eth-to-miden" });
    const valuation = Promise.withResolvers<void>();
    effects.verifyBalanceCap.mockReturnValue(valuation.promise);
    evmRequest.mockImplementation(async ({ method }) => method === "eth_accounts"
      ? [EVM_ADDRESS] : method === "eth_sendTransaction" ? TX_HASH : SEPOLIA_NETWORK.chainHex);

    const submission = submitBridgeTransfer(input, effects);
    await vi.waitFor(() => expect(effects.verifyBalanceCap).toHaveBeenCalledWith(
      findBridgeRoute(input.routeId), input.amount, MIDEN_ACCOUNT,
    ));
    expect(effects.onSubmittingChange).toHaveBeenLastCalledWith(true);
    expect(evmRequest).not.toHaveBeenCalled();
    expect(loadStoredActivities()).toMatchObject([history]);

    if (allowed) valuation.resolve();
    else valuation.reject(new Error("This deposit exceeds the $1,232.462 balance limit."));
    await submission;

    if (allowed) {
      expect(evmRequest.mock.calls.some(([request]) => request.method === "eth_sendTransaction")).toBe(true);
      expect(loadStoredActivities()[0]).toMatchObject({ provider: "agglayer", sourceTxHash: TX_HASH });
      expect(effects.onError).not.toHaveBeenCalled();
    } else {
      expect(evmRequest).not.toHaveBeenCalled();
      expect(effects.onError).toHaveBeenCalledWith("This deposit exceeds the $1,232.462 balance limit.");
      expect(loadStoredActivities()).toMatchObject([history]);
      expect(effects.navigate).not.toHaveBeenCalled();
    }
    expect(effects.onSubmittingChange).toHaveBeenLastCalledWith(false);
    expect(effects.onPhaseChange).toHaveBeenLastCalledWith("");
  });

  it("blocks deposits when no balance-cap verifier is available", async () => {
    const { input, effects, evmRequest } = setup({ routeId: "agglayer-eth-to-miden" });
    await submitBridgeTransfer(input, { ...effects, verifyBalanceCap: undefined });
    expect(effects.onError).toHaveBeenCalledWith(expect.stringContaining("Unable to verify the $1,232.462 balance limit"));
    expect(evmRequest).not.toHaveBeenCalled();
    expect(loadStoredActivities()).toMatchObject([history]);
    expect(effects.navigate).not.toHaveBeenCalled();
  });

  it("requires another review if the quote expires while the account valuation is pending", async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const { input, effects, evmRequest } = setup();
    const valuation = Promise.withResolvers<void>();
    effects.verifyBalanceCap.mockReturnValue(valuation.promise);
    const submission = submitBridgeTransfer(input, effects);
    await vi.waitFor(() => expect(effects.verifyBalanceCap).toHaveBeenCalledOnce());

    clock.mockReturnValue(now + 60_001);
    valuation.resolve();
    await submission;

    expect(effects.onError).toHaveBeenCalledWith("Refresh and review the quote before sending.");
    expect(evmRequest).not.toHaveBeenCalled();
    expect(runEpochTransfer).not.toHaveBeenCalled();
    expect(loadStoredActivities()).toMatchObject([history]);
    expect(effects.navigate).not.toHaveBeenCalled();
    expect(effects.onSubmittingChange).toHaveBeenLastCalledWith(false);
  });

  it.each([
    ...(["missing", "expired", "amount", "routeId", "recovery", "midenAccount", "evmAddress"] as const).map(change => ({ kind: "epoch", change })),
    ...(["missing", "amount", "routeId", "recovery", "midenAccount", "evmAddress"] as const).map(change => ({ kind: "cctp", change })),
  ])(
    "requires another review when the $kind quote has changed $change", async ({ kind, change }) => {
      const { input, effects } = kind === "cctp" ? setupCctp() : setup();
      if (change === "missing") input.quote = undefined;
      else if (change === "expired") input.quote!.validity = { kind: "time", expiresAt: Date.now() - 1 };
      else if (change === "recovery") input.quote!.request.recovery = { ...input.quote!.request.recovery!, id: "changed" };
      else input.quote!.request[change] = "changed";
      await submitBridgeTransfer(input, effects);
      expect(runEpochTransfer).not.toHaveBeenCalled();
      expect(depositViaCctp).not.toHaveBeenCalled();
      expect(loadStoredActivities()).toMatchObject([history]);
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
    expect(loadStoredActivities()).toMatchObject([history]);
    expect(effects.navigate).not.toHaveBeenCalled();
    expect(effects.onSubmittingChange.mock.lastCall?.[0] ?? false).toBe(false);
  });

  it.each(["epoch-test-usdc-to-miden", "agglayer-eth-to-miden", "epoch-test-usdc-to-sepolia"])("requests the EVM connection for a disconnected source or destination on %s", async (routeId) => {
    const { input, effects } = setup({ routeId, evmWallet: { connected: false, address: EVM_ADDRESS } });
    await submitBridgeTransfer(input, effects);

    expect(effects.openEvmWallet).toHaveBeenCalledOnce();
    expect(effects.onSubmittingChange).toHaveBeenLastCalledWith(false);
    expect(runEpochTransfer).not.toHaveBeenCalled();
    expect(loadStoredActivities()).toMatchObject([history]);
  });
});

describe("Agglayer submission", () => {
  it("preserves history and clears progress when the Sepolia deposit is rejected", async () => {
    const { input, effects, evmRequest } = setup({ routeId: "agglayer-eth-to-miden" });
    evmRequest.mockImplementation(async ({ method }) => {
      if (method === "eth_sendTransaction") throw { code: 4001 };
      return method === "eth_accounts" ? [EVM_ADDRESS] : SEPOLIA_NETWORK.chainHex;
    });
    await submitBridgeTransfer(input, effects);

    expect(evmRequest).toHaveBeenLastCalledWith(expect.objectContaining({ method: "eth_sendTransaction" }));
    expect(loadStoredActivities()).toMatchObject([history]);
    expect(effects.navigate).not.toHaveBeenCalled();
    expect(effects.onError).toHaveBeenCalledWith("You cancelled the request in your wallet.");
    expect(effects.onSubmittingChange).toHaveBeenLastCalledWith(false);
    expect(effects.onPhaseChange).toHaveBeenLastCalledWith("");
  });
});

describe("Epoch activity lifecycle", () => {
  it.each([
    { routeId: "epoch-test-usdc-to-miden", mode: "receive", destination: MIDEN_ACCOUNT },
    { routeId: "epoch-usdcx-to-sepolia", mode: "send", destination: EVM_ADDRESS },
  ] as const)("persists $mode accounts and source evidence before navigation, then saves solver tracking data", async ({ routeId, mode, destination }) => {
    const started = Promise.withResolvers<void>();
    const execution = Promise.withResolvers<EpochExecuteResult>();
    const { input, effects } = setup({ routeId });
    effects.navigate.mockImplementation((path: string) => {
      const [activity] = loadStoredActivities();
      expect(path).toBe(`/activity/${activity.id}`);
      expect(activity).toMatchObject({ midenAccount: MIDEN_ACCOUNT, evmAddress: EVM_ADDRESS });
    });
    vi.mocked(runEpochTransfer).mockImplementation(() => {
      expect(effects.navigate).not.toHaveBeenCalled();
      started.resolve();
      return execution.promise;
    });
    const submission = submitBridgeTransfer(input, effects);
    await started.promise;

    expect(loadStoredActivities()).toMatchObject([history]);
    const { onStatus, onSubmitted } = vi.mocked(runEpochTransfer).mock.calls[0][0];
    const progress = { transactionIndex: 0, totalTransactions: 1, chainId: SEPOLIA_NETWORK.chainId };
    onStatus!({ ...progress, phase: "sending" });
    expect(loadStoredActivities()).toMatchObject([history]);
    expect(effects.onPhaseChange).toHaveBeenLastCalledWith("Confirm the deposit in your wallet…");
    onSubmitted!({ sourceTxHash: TX_HASH });
    const [submitted] = loadStoredActivities();
    expect(submitted).toMatchObject({ provider: "epoch", status: "source_finality", sourceTxHash: TX_HASH, destination });

    execution.resolve({
      direction: mode, intentNonce: "42", sponsorAddress: EVM_ADDRESS,
      sourceTxHash: TX_HASH, outputAmount: "0.123456789012345678",
      raw: { taskTypeString: "test", intentData: {} },
    });
    await submission;

    expect(loadStoredActivities()[0]).toMatchObject({
      id: submitted.id, status: "message_observed", eta: "1-3 min",
      epochIntentNonce: "42", epochSponsor: EVM_ADDRESS,
      sourceTxHash: TX_HASH, receivedAmount: "0.123456789012345678",
      midenAccount: MIDEN_ACCOUNT, evmAddress: EVM_ADDRESS,
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

    expect(loadStoredActivities()).toMatchObject([history, other]);
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
    expect(older).toMatchObject(history);
    expect(effects.navigate).toHaveBeenCalledOnce();
    expect(effects.onError).toHaveBeenCalledWith(expect.stringContaining("do not submit again"));
    expect(effects.onSubmittingChange).toHaveBeenLastCalledWith(false);
    expect(effects.onPhaseChange).toHaveBeenLastCalledWith("");
  });
});

describe("USDCx submission", () => {
  it("lets the CCTP provider validate a quote whose estimated expiry has passed", async () => {
    const { input, effects } = setupCctp();
    vi.mocked(depositViaCctp).mockImplementation(async ({ onBroadcast }) => {
      onBroadcast(TX_HASH as `0x${string}`, "250000");
      return TX_HASH as `0x${string}`;
    });
    await submitBridgeTransfer(input, effects);
    expect(depositViaCctp).toHaveBeenCalledOnce();
    expect(depositViaCctp).toHaveBeenCalledWith(expect.objectContaining({
      network: "sepolia", account: EVM_ADDRESS, amount: "1", recipient: MIDEN_ACCOUNT,
      quote: input.quote!.kind === "cctp" ? input.quote!.authorization : undefined,
    }), findBridgeRoute(input.routeId)!.recovery);
    expect(effects.onError).not.toHaveBeenCalled();
    expect(loadStoredActivities()).toMatchObject([{
      provider: "xreserve", sourceTxHash: TX_HASH, xreserveFee: "250000", status: "source_finality",
    }, history]);
  });

  it("saves the actual source nonce after broadcast without overwriting a concurrent activity update", async () => {
    const { input, effects } = setup({ routeId: "xreserve-usdc-to-miden", amount: "1" });
    const transaction: SourceTransaction = { hash: TX_HASH, from: EVM_ADDRESS, nonce: 7, to: EVM_ADDRESS, input: "0x1234", value: "0" };
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
    expect(loadStoredActivities()[1]).toMatchObject(history);
  });

  it("persists the broadcast before navigating and retains it after a later failure", async () => {
    const { input, effects } = setup({ routeId: "xreserve-usdc-to-miden", amount: "1.000001" });
    vi.mocked(depositOnArc).mockImplementation(async ({ onBroadcast }) => {
      expect(loadStoredActivities()).toMatchObject([history]);
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
    expect(loadStoredActivities()).toMatchObject([history]);
    expect(effects.navigate).not.toHaveBeenCalled();
    expect(effects.onSubmittingChange).toHaveBeenLastCalledWith(false);
  });
});


describe("USDCx withdrawal submission", () => {
  const estimate = (): WithdrawalQuote => ({
    recovery: findBridgeRoute("xreserve-usdc-to-arc")!.recovery, network: "arc-testnet",
    amount: "2", sender: MIDEN_ACCOUNT, recipient: EVM_ADDRESS,
    fee: "16400", received: "1983600", expiresAt: Date.now() + 60000,
  });
  const reviewedQuote = () => ({
    kind: "withdrawal" as const, received: "1.9836", fee: "0.0164",
    validity: { kind: "time" as const, expiresAt: Date.now() + 60_000 }, authorization: estimate(),
    request: { recovery: findBridgeRoute("xreserve-usdc-to-arc")!.recovery, routeId: "xreserve-usdc-to-arc", amount: "2", evmAddress: EVM_ADDRESS, midenAccount: MIDEN_ACCOUNT },
  });
  beforeEach(() => vi.mocked(fetchWithdrawalQuote).mockResolvedValue(estimate()));
  it.each([false, true])("retains the burn note across wallet settlement (failure: %s)", async (fails) => {
    const { input, effects, evmRequest } = setup({
      routeId: "xreserve-usdc-to-arc", amount: "2", evmAddress: EVM_ADDRESS, quote: reviewedQuote(),
      evmWallet: { connected: true, address: EVM_ADDRESS },
    });
    // A failed deposit valuation must never keep users from withdrawing funds.
    effects.verifyBalanceCap.mockRejectedValue(new Error("Balance limit exceeded"));
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
    expect(effects.verifyBalanceCap).not.toHaveBeenCalled();
    expect(evmRequest).not.toHaveBeenCalled();
    if (fails) expect(effects.onError).toHaveBeenCalledWith(expect.stringContaining("do not submit again"));
  });
  it("requires another review when Circle increases the fee before signing", async () => {
    const { input, effects } = setup({ routeId: "xreserve-usdc-to-arc", amount: "2", quote: reviewedQuote() });
    vi.mocked(fetchWithdrawalQuote).mockResolvedValue({ ...estimate(), fee: "20000", received: "1980000" });
    await submitBridgeTransfer(input, effects);
    expect(withdrawUsdcx).not.toHaveBeenCalled();
    expect(loadStoredActivities()).toMatchObject([history]);
    expect(effects.onError).toHaveBeenCalledWith(expect.stringContaining("fee increased"));
  });
  it("leaves no withdrawal activity after a rejected signature", async () => {
    const { input, effects } = setup({ routeId: "xreserve-usdc-to-arc", amount: "2", quote: reviewedQuote() });
    vi.mocked(withdrawUsdcx).mockRejectedValue(new Error("User rejected request"));
    await submitBridgeTransfer(input, effects);
    expect(loadStoredActivities()).toMatchObject([history]);
    expect(effects.navigate).not.toHaveBeenCalled();
  });
});

describe("network-bound submission", () => {
  const mainnetAccount = "mm1aqu8zjdwvcgkeug5a67kpwmnsyv2qgp7";
  const testnetAccount = "mtst1aqu8zjdwvcgkeug5a67kpwmnsymvmkg0";
  const mainnet = routesForEnvironment("mainnet").find(route => route.provider === "agglayer" && route.mode === "receive")!;
  it.each([
    { environment: "mainnet" as const, routeId: mainnet.id, account: testnetAccount, message: /Switch Bread to mainnet/ },
    { environment: "testnet" as const, routeId: "agglayer-eth-to-miden", account: mainnetAccount, message: /Switch Bread to testnet/ },
    { environment: "testnet" as const, routeId: mainnet.id, account: mainnetAccount, message: /isn't available/ },
  ])("rejects $environment submissions with the wrong route or wallet before signing", async ({ environment, routeId, account, message }) => {
    const { input, effects, evmRequest } = setup({ environment, routeId, midenAccount: account, midenWallet: { connected: true, address: account } });
    await submitBridgeTransfer(input, effects);
    expect(effects.onError).toHaveBeenCalledWith(expect.stringMatching(message));
    expect(evmRequest).not.toHaveBeenCalled();
    expect(effects.navigate).not.toHaveBeenCalled();
    expect(loadStoredActivities()).toHaveLength(1);
  });
  it("signs on Ethereum for rollup 30 and persists a mainnet receipt alongside testnet history", async () => {
    const { input, effects, evmRequest } = setup({ environment: "mainnet", routeId: mainnet.id, midenAccount: mainnetAccount,
      midenWallet: { connected: true, address: mainnetAccount }, amount: "0.01" });
    evmRequest.mockImplementation(async ({ method }) => method === "eth_accounts" ? [EVM_ADDRESS] : method === "eth_sendTransaction" ? TX_HASH : "0x1");
    await submitBridgeTransfer(input, effects);
    expect(effects.onError).not.toHaveBeenCalled();
    const sent = evmRequest.mock.calls.find(([request]) => request.method === "eth_sendTransaction")![0].params as [{ chainId: string; value: string; data: `0x${string}` }];
    expect(sent[0]).toMatchObject({ chainId: "0x1", value: "0x2386f26fc10000" });
    const decoded = decodeFunctionData({ abi: parseAbi(["function bridgeAsset(uint32,address,uint256,address,bool,bytes) payable"]), data: sent[0].data });
    expect(decoded.args?.map(value => typeof value === "string" ? value.toLowerCase() : value)).toEqual([30, "0x00000000387149ae66116cf114eebd60bb738100", 10_000_000_000_000_000n, "0x0000000000000000000000000000000000000000", true, "0x"]);
    expect(loadStoredActivities("mainnet")).toMatchObject([{ sourceTxHash: TX_HASH, destinationNetworkId: 30, environment: "mainnet", routeSnapshot: { recovery: mainnet.recovery } }]);
    expect(loadStoredActivities("testnet")).toMatchObject([history]);
    expect(effects.navigate).toHaveBeenCalledWith(expect.stringMatching(/^\/activity\//));
  });
});

describe("Ethereum ERC-20 deposits", () => {
  const bridge = "0x2a3dd3eb832af982ec71669e178424b10dca2ede";
  const account = "mm1aqu8zjdwvcgkeug5a67kpwmnsyv2qgp7";
  const approvalHash = `0x${"cd".repeat(32)}`;
  const bridgeAbi = parseAbi(["function bridgeAsset(uint32,address,uint256,address,bool,bytes) payable"]);
  const approveAbi = parseAbi(["function approve(address,uint256)"]);
  beforeEach(() => {
    allowance.mockResolvedValue(10n ** 24n);
    tokenRpc.readContract.mockImplementation(async ({ functionName }) =>
      functionName === "balanceOf" ? 10n ** 24n : allowance());
    tokenRpc.call.mockResolvedValue({ data: "0x" });
    tokenRpc.estimateGas.mockResolvedValue(100_000n);
    tokenRpc.waitForTransactionReceipt.mockResolvedValue({ status: "success" });
  });
  function deposit(symbol = "USDT", amount = "1") {
    const route = routesForEnvironment("mainnet").find(route =>
      route.provider === "agglayer" && route.mode === "receive" && route.source.symbol === symbol)!;
    const state = setup({ environment: "mainnet", routeId: route.id, amount, midenAccount: account,
      midenWallet: { connected: true, address: account } });
    state.evmRequest.mockImplementation(async ({ method, params }) => {
      if (method === "eth_accounts") return [EVM_ADDRESS];
      if (method === "eth_sendTransaction") {
        const [tx] = params as [{ to: string }];
        return tx.to.toLowerCase() === bridge ? TX_HASH : approvalHash;
      }
      return "0x1";
    });
    const transactions = () => state.evmRequest.mock.calls
      .filter(([request]) => request.method === "eth_sendTransaction")
      .map(([request]) => (request.params as [{ to: string; data: `0x${string}`; value: string; chainId: string }])[0]);
    return { ...state, transactions };
  }

  it.each([
    ["USDT", "1.234567", 1_234_567n, "0xdac17f958d2ee523a2206206994597c13d831ec7"],
    ["WBTC", "0.12345678", 12_345_678n, "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599"],
    ["PYUSD", "1.234567", 1_234_567n, "0x6c3ea9036406852006290770bedfcaba0e23a0e8"],
    ["WSOL", "0.123456780", 123_456_780n, "0xd31a59c85ae9d8edefec411d448f90841571b89c"],
    ["NEAR", "0.123456780000000000000000", 123_456_780_000_000_000_000_000n, "0x85f17cf997934a597031b2e18a9ab6ebd4b9f6a4"],
  ] as const)("deposits %s in source units with zero ETH value and keeps its receipt", async (symbol, amount, units, token) => {
    const { input, effects, transactions } = deposit(symbol, amount);
    await submitBridgeTransfer(input, effects);
    expect(effects.onError).not.toHaveBeenCalled();
    expect(transactions()).toHaveLength(1); // Existing allowance needs no approval.
    expect(transactions()[0]).toMatchObject({ to: bridge, chainId: "0x1", value: "0x0" });
    const decoded = decodeFunctionData({ abi: bridgeAbi, data: transactions()[0].data });
    expect(decoded.args.map(value => typeof value === "string" ? value.toLowerCase() : value)).toEqual([
      30, "0x00000000387149ae66116cf114eebd60bb738100", units, token, true, "0x",
    ]);
    expect(loadStoredActivities("mainnet")).toMatchObject([{
      asset: symbol, amount, sourceTxHash: TX_HASH, status: "source_finality",
      routeSnapshot: { source: { address: token }, destination: { kind: "miden", symbol } },
    }]);
    expect(loadStoredActivities("testnet")).toMatchObject([history]);
  });

  it("waits for USDT's zero reset and exact approval before submitting the deposit", async () => {
    const reset = Promise.withResolvers<{ status: string }>();
    const approved = Promise.withResolvers<{ status: string }>();
    allowance.mockReset().mockResolvedValueOnce(1n).mockResolvedValueOnce(0n).mockResolvedValueOnce(1_000_000n);
    tokenRpc.waitForTransactionReceipt.mockReturnValueOnce(reset.promise).mockReturnValueOnce(approved.promise);
    const { input, effects, transactions } = deposit();
    const submission = submitBridgeTransfer(input, effects);
    await vi.waitFor(() => expect(tokenRpc.waitForTransactionReceipt).toHaveBeenCalledTimes(1));
    expect(transactions()).toHaveLength(1);
    expect(decodeFunctionData({ abi: approveAbi, data: transactions()[0].data }).args.map(value =>
      typeof value === "string" ? value.toLowerCase() : value)).toEqual([bridge, 0n]);
    expect(loadStoredActivities()).toMatchObject([history]);
    reset.resolve({ status: "success" });
    await vi.waitFor(() => expect(tokenRpc.waitForTransactionReceipt).toHaveBeenCalledTimes(2));
    expect(transactions()).toHaveLength(2);
    expect(decodeFunctionData({ abi: approveAbi, data: transactions()[1].data }).args.map(value =>
      typeof value === "string" ? value.toLowerCase() : value)).toEqual([bridge, 1_000_000n]);
    expect(transactions().every(tx => tx.to.toLowerCase() === "0xdac17f958d2ee523a2206206994597c13d831ec7" && tx.value === "0x0")).toBe(true);
    expect(loadStoredActivities()).toMatchObject([history]);
    approved.resolve({ status: "success" });
    await submission;
    expect(effects.onError).not.toHaveBeenCalled();
    expect(transactions()).toHaveLength(3);
    expect(transactions()[2].to).toBe(bridge);
    expect(loadStoredActivities("mainnet")[0].sourceTxHash).toBe(TX_HASH);
  });

  it.each([
    ["rejected approval", /cancelled/],
    ["reverted approval", /approval failed/],
    ["false approval result", /approval was refused/],
    ["unchanged allowance", /allowance was not updated/],
    ["changed account", /account or network changed/],
    ["changed network", /account or network changed/],
    ["insufficient balance", /Not enough USDT/],
  ] as const)("does not deposit or create a receipt after %s", async (failure, message) => {
    allowance.mockReset().mockResolvedValueOnce(0n).mockResolvedValue(1_000_000n);
    const { input, effects, evmRequest, transactions } = deposit();
    if (failure === "rejected approval") evmRequest.mockImplementation(async ({ method }) => {
      if (method === "eth_sendTransaction") throw { code: 4001 };
      return method === "eth_accounts" ? [EVM_ADDRESS] : "0x1";
    });
    if (failure === "false approval result") tokenRpc.call.mockResolvedValue({ data: `0x${"0".repeat(64)}` });
    if (failure === "reverted approval") tokenRpc.waitForTransactionReceipt.mockResolvedValue({ status: "reverted" });
    if (failure === "unchanged allowance") allowance.mockReset().mockResolvedValue(0n);
    if (failure === "insufficient balance") tokenRpc.readContract.mockResolvedValue(0n);
    if (failure === "changed account" || failure === "changed network") {
      tokenRpc.waitForTransactionReceipt.mockImplementation(async () => {
        evmRequest.mockImplementation(async ({ method }) => method === "eth_accounts"
          ? [failure === "changed account" ? "0x2222222222222222222222222222222222222222" : EVM_ADDRESS]
          : failure === "changed network" ? "0xaa36a7" : "0x1");
        return { status: "success" };
      });
    }
    await submitBridgeTransfer(input, effects);
    expect(effects.onError).toHaveBeenCalledWith(expect.stringMatching(message));
    expect(transactions().some(tx => tx.to.toLowerCase() === bridge)).toBe(false);
    expect(loadStoredActivities()).toMatchObject([history]);
    expect(effects.navigate).not.toHaveBeenCalled();
  });

  it.each([
    ["WSOL", "0.000000001", /at most 8 decimal places/],
    ["ETH", "0.000000000000000001", /at most 8 decimal places/],
    ["USDT", "9223372034707.292161", /per-transfer USDT limit/],
  ])("rejects unrepresentable %s amounts before a wallet prompt", async (symbol, amount, message) => {
    const { input, effects, evmRequest } = deposit(symbol, amount);
    await submitBridgeTransfer(input, effects);
    expect(effects.onError).toHaveBeenCalledWith(expect.stringMatching(message));
    expect(evmRequest).not.toHaveBeenCalled();
    expect(loadStoredActivities()).toMatchObject([history]);
  });
});
