import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NoteType, TransactionRequest, Address } from "@miden-sdk/miden-sdk";
import { submitBridgeTransfer, type TransferSubmission } from "../../../app/lib/bridge-submission";
import { activityPersistence, loadStoredActivities } from "../../../app/lib/bridge-persistence";
import { activityDetailFor } from "../../../app/lib/activity-detail-presentation";
import { ActivityStore } from "../../activity";
import { findBridgeRoute } from "../../core/routes";
import { getMidenVerificationBaseFee } from "../../miden-rpc";
import { nearQuoteResult } from "./quote";
import { nearMonitor } from "./tracking";
import { nearTestInput, signedNearQuote, nearStatus, nearTxHash, testManagerKey } from "../../../../test/near-quotes";

vi.hoisted(() => { process.env.NEXT_PUBLIC_NEAR_ENABLED = "true"; });
vi.mock("@miden-sdk/miden-sdk", async () => (await import("../../../../test/miden-sdk")).browserMidenSdk());
vi.mock("@miden-sdk/miden-wallet-adapter-base", () => import("@miden-sdk/miden-wallet-adapter-base/dist/transaction.js"));
vi.mock("../../miden-rpc", () => ({ getMidenVerificationBaseFee: vi.fn(async () => 100) }));
vi.mock("@defuse-protocol/one-click-sdk-typescript", async importOriginal => {
  const actual = await importOriginal<typeof import("@defuse-protocol/one-click-sdk-typescript")>();
  return { ...actual, verifyQuoteSignature: (response: Parameters<typeof actual.verifyQuoteSignature>[0]) => actual.verifyQuoteSignature(response, testManagerKey) };
});

const fetcher = vi.fn<typeof fetch>();
beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("window", { localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } });
  vi.stubGlobal("navigator", { locks: { request: async (_name: string, callback: () => Promise<void>) => callback() } });
  vi.stubGlobal("fetch", fetcher); fetcher.mockReset();
  vi.mocked(getMidenVerificationBaseFee).mockResolvedValue(100);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function setup() {
  const quote = signedNearQuote();
  const route = findBridgeRoute(nearTestInput.routeId)!;
  let output: ReturnType<TransactionRequest["expectedOutputOwnNotes"]>[number];
  const requestTransaction = vi.fn<NonNullable<TransferSubmission["midenWallet"]["requestTransaction"]>>(async transaction => {
    const saved = loadStoredActivities()[0];
    expect(saved.near?.submission).toBe("attempted");
    if (!("transactionRequest" in transaction.payload)) throw new Error("Expected a serialized custom wallet request");
    const request = TransactionRequest.deserialize(Buffer.from(transaction.payload.transactionRequest, "base64"));
    const notes = request.expectedOutputOwnNotes();
    expect(notes).toHaveLength(1); output = notes[0];
    expect(saved.midenNoteId).toBe(output.id().toString());
    expect(output.metadata().noteType()).toBe(NoteType.Public);
    expect(output.metadata().tag().asU32()).toBe(Address.fromBech32(quote.quote.depositAddress!).toNoteTag().asU32());
    expect(output.assets().fungibleAssets().map(asset => [asset.faucetId().toString(), asset.amount()])).toEqual([[route.recovery.derived.usdcxFaucetId, 5_000_000n]]);
    expect(output.recipient().storage().items().map(felt => felt.asInt())).toEqual([0x14eebd60bb738100n, 0x787149ae66116cf1n, 0n, 0n]);
    expect(transaction.payload.recipientAddress).toBe(quote.quote.depositAddress);
    return "near-wallet-request";
  });
  const waitForTransaction = vi.fn<NonNullable<TransferSubmission["midenWallet"]["waitForTransaction"]>>(async () => {
    expect(loadStoredActivities()[0].midenWalletRequestId).toBe("near-wallet-request");
    return { txHash: nearTxHash, outputNotes: [output] };
  });
  const requestAssets = vi.fn().mockResolvedValue([{ faucetId: route.recovery.derived.usdcxFaucetId, amount: "10000000" }]);
  const evmRequest = vi.fn().mockResolvedValue([nearTestInput.evmAddress]);
  const input: TransferSubmission = {
    ...nearTestInput, routeId: route.id, environment: "mainnet", insufficientBalance: false, evmBalance: "", midenAsset: null,
    quote: { ...nearQuoteResult(quote, route.id), request: { ...nearTestInput, recovery: route.recovery } },
    evmWallet: { connected: true, address: nearTestInput.evmAddress, provider: { request: evmRequest } },
    midenWallet: { connected: true, address: nearTestInput.midenAccount, requestAssets, requestTransaction, waitForTransaction },
  };
  const effects = { openEvmWallet: vi.fn(), onError: vi.fn(), onSubmittingChange: vi.fn(), onPhaseChange: vi.fn(),
    activities: new ActivityStore(activityPersistence), navigate: vi.fn() };
  effects.activities.sync();
  fetcher.mockImplementation(async path => String(path).endsWith("prepare") ? Response.json(quote) : Response.json(nearStatus(quote)));
  return { input, effects, quote, requestTransaction, waitForTransaction, requestAssets, evmRequest };
}

it("persists a public P2ID and silently retries optional notifications without a second deposit", async () => {
  const test = setup();
  // Optional notification failure must leave the successful wallet submission intact.
  fetcher.mockImplementation(async path => String(path).endsWith("prepare") ? Response.json(test.quote) : Response.json({ error: "Temporary outage" }, { status: 503 }));
  await submitBridgeTransfer(test.input, test.effects);
  expect(test.effects.onError).not.toHaveBeenCalled();
  const saved = loadStoredActivities()[0];
  expect(saved).toMatchObject({ sourceTxHash: nearTxHash, destination: nearTestInput.evmAddress, midenWalletRequestId: "near-wallet-request", near: { submission: "confirmed", notification: "pending", networkFee: "0.003 USDCx" } });
  test.effects.activities = new ActivityStore(activityPersistence); test.effects.activities.sync();
  await submitBridgeTransfer(test.input, test.effects);
  expect(test.requestTransaction).toHaveBeenCalledTimes(1);

  fetcher.mockImplementation(async path => String(path).endsWith("status")
    ? Response.json(nearStatus(test.quote)) : Response.json({ error: "Temporary outage" }, { status: 503 }));
  const observed = await nearMonitor.observe(saved, new AbortController().signal);
  expect(observed.warning).toBeUndefined();
  test.effects.activities.patch(saved.id, observed.patch);
  const pending = loadStoredActivities()[0];
  expect(pending).toMatchObject({ status: "source_finality", sourceTxHash: nearTxHash, near: { notification: "pending" } });
  expect(nearMonitor.canPoll(pending)).toBe(true);

  fetcher.mockImplementation(async path => String(path).endsWith("status")
    ? Response.json(nearStatus(test.quote)) : Response.json({}));
  const retried = await nearMonitor.observe(pending, new AbortController().signal);
  expect(retried.warning).toBeUndefined();
  test.effects.activities.patch(saved.id, retried.patch);
  expect(loadStoredActivities()[0].near?.notification).toBe("sent");
  expect(test.requestTransaction).toHaveBeenCalledTimes(1);
});

it("retains wallet acceptance across reload and treats delayed status as pending", async () => {
  const test = setup();
  test.waitForTransaction.mockRejectedValueOnce(new Error("Wallet response interrupted"));
  await submitBridgeTransfer(test.input, test.effects);
  expect(loadStoredActivities()[0]).toMatchObject({ near: { submission: "accepted" }, midenWalletRequestId: "near-wallet-request" });
  test.effects.activities = new ActivityStore(activityPersistence); test.effects.activities.sync();
  await submitBridgeTransfer(test.input, test.effects);
  expect(test.requestTransaction).toHaveBeenCalledTimes(1);
  fetcher.mockRejectedValueOnce(new DOMException("Timeout", "TimeoutError"));
  const saved = loadStoredActivities()[0];
  const observed = await nearMonitor.observe(saved, new AbortController().signal);
  test.effects.activities.patch(saved.id, observed.patch);
  expect(test.effects.activities.get(saved.id)?.activity.status).toBe("source_finality");
  expect(observed.warning).toMatch(/remains pending/);
});

it.each(["wrong-faucet", "fee-shortfall", "wallet-change", "evm-wallet-change", "memo", "storage-failure", "expired", "preview"])("stops %s before the wallet prompt", async failure => {
  const test = setup();
  if (failure === "wrong-faucet") test.requestAssets.mockResolvedValue([{ faucetId: "0x419f8f4bff72959132aa7cea15a4c1", amount: "10000000" }]);
  if (failure === "fee-shortfall") test.requestAssets.mockResolvedValue([{ faucetId: findBridgeRoute(nearTestInput.routeId)!.recovery.derived.usdcxFaucetId, amount: "5000000" }]);
  if (failure === "wallet-change") test.input.midenWallet.address = "mm1another";
  if (failure === "evm-wallet-change") test.evmRequest.mockResolvedValue(["0x2222222222222222222222222222222222222222"]);
  if (failure === "memo") test.input.quote = { ...test.input.quote!, ...nearQuoteResult(signedNearQuote(nearTestInput, false, { depositMemo: "required-memo" }), nearTestInput.routeId) };
  if (failure === "storage-failure") vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new Error("Quota"); });
  if (failure === "expired") test.input.quote!.validity = { kind: "time", expiresAt: Date.now() - 1 };
  if (failure === "preview") test.input.quote = { ...test.input.quote!, ...nearQuoteResult(signedNearQuote(nearTestInput, true), nearTestInput.routeId) };
  await submitBridgeTransfer(test.input, test.effects);
  expect(test.effects.onError).toHaveBeenCalled();
  expect(test.requestTransaction).not.toHaveBeenCalled();
});

it("renders a refund separately from EVM delivery and ignores stale pending polls", async () => {
  const test = setup();
  await submitBridgeTransfer(test.input, test.effects);
  expect(test.effects.onError).not.toHaveBeenCalled();
  const saved = loadStoredActivities()[0];
  const response = { ...nearStatus(test.quote, "REFUNDED"), swapDetails: { originChainTxHashes: [{ hash: nearTxHash }], destinationChainTxHashes: [], refundedAmount: "4990000", refundReason: "INSUFFICIENT_LIQUIDITY" } };
  fetcher.mockResolvedValueOnce(Response.json(response));
  const observed = await nearMonitor.observe(saved, new AbortController().signal);
  test.effects.activities.patch(saved.id, observed.patch);
  test.effects.activities.patch(saved.id, { near: { ...saved.near!, submission: "attempted" } });
  const refunded = test.effects.activities.get(saved.id)!.activity;
  expect(refunded).toMatchObject({ status: "refunded", near: { submission: "confirmed", refundedAmount: "4.99", status: "REFUNDED" } });
  expect(nearMonitor.canPoll(refunded)).toBe(false);
  expect(activityDetailFor(refunded)).toMatchObject({ receipt: { receivedAmount: "0", receivedLabel: "EVM delivery", refund: "4.99 USDCx" }, guidance: { title: "Refunded to Miden" } });
});

it.each([
  ["INCOMPLETE_DEPOSIT", "source_finality", true], ["PROCESSING", "message_observed", true],
  ["SUCCESS", "complete", false], ["FAILED", "failed", false],
] as const)("tracks %s without confusing it with delivery", async (status, expected, canPoll) => {
  const test = setup();
  await submitBridgeTransfer(test.input, test.effects);
  expect(test.effects.onError).not.toHaveBeenCalled();
  const activity = loadStoredActivities()[0];
  fetcher.mockResolvedValueOnce(Response.json({ ...nearStatus(test.quote, status), swapDetails: {
    originChainTxHashes: [{ hash: nearTxHash }], destinationChainTxHashes: status === "SUCCESS" ? [{ hash: `0x${"cd".repeat(32)}` }] : [], amountOut: "4970000",
  } }));
  const observation = await nearMonitor.observe(activity, new AbortController().signal);
  test.effects.activities.patch(activity.id, observation.patch);
  const result = test.effects.activities.get(activity.id)!.activity;
  expect(result.status).toBe(expected);
  expect(nearMonitor.canPoll(result)).toBe(canPoll);
  expect(result.destinationTxHash).toBe(status === "SUCCESS" ? `0x${"cd".repeat(32)}` : undefined);
});
