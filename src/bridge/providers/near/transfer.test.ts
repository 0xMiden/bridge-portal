import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Address, NoteScript, NoteType, TransactionRequest } from "@miden-sdk/miden-sdk";
import { submitBridgeTransfer, type TransferSubmission } from "../../../app/lib/bridge-submission";
import { activityPersistence, loadStoredActivities } from "../../../app/lib/bridge-persistence";
import { activityDetailFor } from "../../../app/lib/activity-detail-presentation";
import { ActivityStore } from "../../activity";
import { findBridgeRoute } from "../../core/routes";
import { getMidenBlockInfo } from "../../miden-rpc";
import { nearQuoteResult } from "./quote";
import { nearMonitor } from "./tracking";
import { nearTestInput, bitcoinAddress, nearQuoteFixture, nearStatus, nearTxHash } from "../../../../test/near-quotes";

vi.mock("@miden-sdk/miden-sdk", async () => (await import("../../../../test/miden-sdk")).browserMidenSdk());
vi.mock("@miden-sdk/miden-wallet-adapter-base", () => import("@miden-sdk/miden-wallet-adapter-base/dist/transaction.js"));
vi.mock("../../miden-rpc", () => ({ getMidenBlockInfo: vi.fn() }));
vi.mock("@defuse-protocol/one-click-sdk-typescript", async importOriginal => {
  const actual = await importOriginal<typeof import("@defuse-protocol/one-click-sdk-typescript")>();
  return { ...actual, verifyQuoteSignature: vi.fn(() => true) };
});

const fetcher = vi.fn<typeof fetch>();
beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("window", { localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } });
  vi.stubGlobal("navigator", { locks: { request: async (_name: string, callback: () => Promise<void>) => callback() } });
  vi.stubGlobal("fetch", fetcher); fetcher.mockReset();
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

function setup(bitcoin = false) {
  const transferInput = bitcoin ? { ...nearTestInput, externalAddress: bitcoinAddress, amount: "0.001",
    routeId: "mainnet:near-miden-wbtc-to-bitcoin-btc" } : nearTestInput;
  const quote = nearQuoteFixture(transferInput);
  const route = findBridgeRoute(transferInput.routeId)!;
  const faucet = bitcoin ? "0x3084d3c389ececd15fda9770d18c8a" : route.recovery.derived.usdcxFaucetId;
  const amount = bitcoin ? 100_000n : 5_000_000n;
  const blockNumber = bitcoin ? 1_000_000 : 940_790;
  vi.mocked(getMidenBlockInfo).mockResolvedValue({ blockNumber, verificationBaseFee: 100 });
  let output: ReturnType<TransactionRequest["expectedOutputOwnNotes"]>[number];
  const requestTransaction = vi.fn<NonNullable<TransferSubmission["midenWallet"]["requestTransaction"]>>(async transaction => {
    const saved = loadStoredActivities()[0];
    expect(saved.near?.submission).toBe("attempted");
    if (!("transactionRequest" in transaction.payload)) throw new Error("Expected a serialized custom wallet request");
    const request = TransactionRequest.deserialize(Buffer.from(transaction.payload.transactionRequest, "base64"));
    const notes = request.expectedOutputOwnNotes();
    expect(notes).toHaveLength(1); output = notes[0];
    expect(saved.midenNoteId).toBe(output.id().toString());
    expect(output.script().root().toHex()).toBe(NoteScript.p2ide().root().toHex());
    expect(output.metadata().noteType()).toBe(NoteType.Public);
    expect(output.metadata().tag().asU32()).toBe(Address.fromBech32(quote.quote.depositAddress!).toNoteTag().asU32());
    expect(output.assets().fungibleAssets().map(asset => [asset.faucetId().toString(), asset.amount()])).toEqual([[faucet, amount]]);
    expect(output.recipient().storage().items().map(felt => felt.asInt())).toEqual([
      0x14eebd60bb738100n, 0x387149ae66116cf1n, // Sender can reclaim.
      0x14eebd60bb738100n, 0x787149ae66116cf1n, // Quoted recipient can consume immediately.
      BigInt(blockNumber) + 5_200n, 0n,
    ]);
    const attachments = output.attachments();
    expect(attachments).toHaveLength(1);
    const [attachment] = attachments;
    expect(attachment.attachmentScheme().isNone()).toBe(true);
    expect(attachment.toWords().map(word => Array.from(word.toU64s()))).toEqual([[0n, 0n, 0n, 0n]]);
    expect(transaction.payload.recipientAddress).toBe(quote.quote.depositAddress);
    return "near-wallet-request";
  });
  const waitForTransaction = vi.fn<NonNullable<TransferSubmission["midenWallet"]["waitForTransaction"]>>(async () => {
    expect(loadStoredActivities()[0].midenWalletRequestId).toBe("near-wallet-request");
    return { txHash: nearTxHash, outputNotes: [output] };
  });
  const requestAssets = vi.fn().mockResolvedValue([{ faucetId: faucet, amount: "10000000" },
    ...(bitcoin ? [{ faucetId: route.recovery.derived.usdcxFaucetId, amount: "10000" }] : [])]);
  const evmRequest = vi.fn().mockResolvedValue([nearTestInput.externalAddress]);
  const assertBitcoinAccount = vi.fn().mockResolvedValue(undefined);
  const input: TransferSubmission = {
    ...transferInput, routeId: route.id, environment: "mainnet", insufficientBalance: false, sourceBalance: "", midenAsset: null,
    quote: { ...nearQuoteResult(quote, route.id), request: { ...transferInput, recovery: route.recovery } },
    externalWallet: bitcoin
      ? { family: "bitcoin", connected: true, address: bitcoinAddress, assertAccount: assertBitcoinAccount, provider: { getAccountAddresses: vi.fn(), sendTransfer: vi.fn() } }
      : { family: "evm", connected: true, address: transferInput.externalAddress, provider: { request: evmRequest } },
    midenWallet: { connected: true, address: nearTestInput.midenAccount, assertAccount: vi.fn(), requestAssets, requestTransaction, waitForTransaction },
  };
  const effects = { openExternalWallet: vi.fn(), onError: vi.fn(), onSubmittingChange: vi.fn(), onPhaseChange: vi.fn(),
    activities: new ActivityStore(activityPersistence), navigate: vi.fn() };
  effects.activities.sync();
  fetcher.mockImplementation(async path => String(path).endsWith("prepare") ? Response.json(quote) : Response.json(nearStatus(quote)));
  return { input, effects, quote, requestTransaction, waitForTransaction, requestAssets, evmRequest, assertBitcoinAccount };
}

it.each([
  { first: 502, retry: 200, attempts: 2, notification: "sent" },
  { first: 502, retry: 502, attempts: 2, notification: "pending" },
  { first: 422, retry: 200, attempts: 1, notification: "pending" },
])("keeps tracking one P2IDE deposit after notification responses $first/$retry", async ({ first, retry, attempts, notification }) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const test = setup();
  let notifications = 0;
  let statusPolls = 0;
  fetcher.mockImplementation(async path => {
    if (String(path).endsWith("prepare")) return Response.json(test.quote);
    if (String(path).endsWith("status")) {
      statusPolls++;
      return Response.json(nearStatus(test.quote));
    }
    const status = ++notifications === 1 ? first : retry;
    return Response.json({}, { status });
  });
  await submitBridgeTransfer(test.input, test.effects);
  expect(test.effects.onError).not.toHaveBeenCalled();
  const saved = loadStoredActivities()[0];
  expect(saved).toMatchObject({ sourceTxHash: nearTxHash, destination: nearTestInput.externalAddress, midenWalletRequestId: "near-wallet-request", near: { submission: "confirmed", notification: "pending", networkFee: "0.003 USDCx" } });
  expect(notifications).toBe(1);
  test.effects.activities = new ActivityStore(activityPersistence); test.effects.activities.sync();
  await submitBridgeTransfer(test.input, test.effects);

  const submittedAt = Date.now();
  for (const elapsed of [5_000, 25_000, 30_000, 60_000, 120_000]) {
    vi.setSystemTime(submittedAt + elapsed);
    const observed = await nearMonitor.observe(loadStoredActivities()[0], new AbortController().signal);
    expect(observed.warning).toBeUndefined();
    test.effects.activities.patch(saved.id, observed.patch);
    expect(notifications).toBe(elapsed < 30_000 ? 1 : attempts);
  }
  expect(statusPolls).toBe(5);
  expect(loadStoredActivities()[0]).toMatchObject({ status: "source_finality", sourceTxHash: nearTxHash, near: { notification } });
  fetcher.mockResolvedValueOnce(Response.json({ ...nearStatus(test.quote, "SUCCESS"), swapDetails: {
    originChainTxHashes: [{ hash: nearTxHash }], destinationChainTxHashes: [{ hash: `0x${"cd".repeat(32)}` }], amountOut: "4970000",
  } }));
  const delivered = await nearMonitor.observe(loadStoredActivities()[0], new AbortController().signal);
  test.effects.activities.patch(saved.id, delivered.patch);
  expect(loadStoredActivities()[0]).toMatchObject({ status: "complete", receivedAmount: "4.97" });
  expect(test.requestTransaction).toHaveBeenCalledTimes(1);
});

it("retains wallet acceptance across reload and treats delayed status as pending", async () => {
  const test = setup();
  // Even a rejection code from the confirmation call comes after wallet acceptance.
  test.waitForTransaction.mockRejectedValueOnce(Object.assign(new Error("User rejected the request"), { code: 4001 }));
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

it("stops before requesting funds when the reclaim height would overflow the on-chain block number", async () => {
  const test = setup();
  vi.mocked(getMidenBlockInfo).mockResolvedValueOnce({ blockNumber: 0xffff_ffff, verificationBaseFee: 100 });
  await submitBridgeTransfer(test.input, test.effects);
  expect(test.effects.onError).toHaveBeenCalledWith("Invalid Miden block height for NEAR deposit recovery.");
  expect(test.requestTransaction).not.toHaveBeenCalled();
  expect(loadStoredActivities()).toHaveLength(0);
});

it.each(["wrong-faucet", "fee-shortfall", "wallet-change", "evm-wallet-change", "memo", "storage-failure", "expired", "preview"])("stops %s before the wallet prompt", async failure => {
  const test = setup();
  if (failure === "wrong-faucet") test.requestAssets.mockResolvedValue([{ faucetId: "0x419f8f4bff72959132aa7cea15a4c1", amount: "10000000" }]);
  if (failure === "fee-shortfall") test.requestAssets.mockResolvedValue([{ faucetId: findBridgeRoute(nearTestInput.routeId)!.recovery.derived.usdcxFaucetId, amount: "5000000" }]);
  if (failure === "wallet-change") test.input.midenWallet.address = "mm1another";
  if (failure === "evm-wallet-change") test.evmRequest.mockResolvedValue(["0x2222222222222222222222222222222222222222"]);
  if (failure === "memo") test.input.quote = { ...test.input.quote!, ...nearQuoteResult(nearQuoteFixture(nearTestInput, false, { depositMemo: "required-memo" }), nearTestInput.routeId) };
  if (failure === "storage-failure") vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new Error("Quota"); });
  if (failure === "expired") test.input.quote!.validity = { kind: "time", expiresAt: Date.now() - 1 };
  if (failure === "preview") test.input.quote = { ...test.input.quote!, ...nearQuoteResult(nearQuoteFixture(nearTestInput, true), nearTestInput.routeId) };
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
  fetcher.mockResolvedValueOnce(Response.json(nearStatus(test.quote, "PENDING_DEPOSIT")));
  const late = await nearMonitor.observe(saved, new AbortController().signal);
  test.effects.activities.patch(saved.id, late.patch);
  const refunded = test.effects.activities.get(saved.id)!.activity;
  expect(refunded).toMatchObject({ status: "refunded", near: { submission: "confirmed", refundedAmount: "4.99",
    refundReason: "INSUFFICIENT_LIQUIDITY", originTxHashes: [nearTxHash], status: "REFUNDED" } });
  expect(nearMonitor.canPoll(refunded)).toBe(false);
  expect(activityDetailFor(refunded)).toMatchObject({ receipt: { receivedAmount: "0", receivedLabel: "Destination delivery", refund: "4.99 USDCx" }, guidance: { title: "Refunded to Miden" } });
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

it("withdraws wBTC to a reviewed Bitcoin address using one public Miden note without an EVM wallet", async () => {
  const test = setup(true);
  await submitBridgeTransfer(test.input, test.effects);
  expect(test.effects.onError).not.toHaveBeenCalled();
  expect(test.evmRequest).not.toHaveBeenCalled();
  expect(test.effects.openExternalWallet).not.toHaveBeenCalled();
  const saved = loadStoredActivities()[0];
  expect(saved).toMatchObject({ destination: bitcoinAddress, sourceTxHash: nearTxHash });
  await submitBridgeTransfer(test.input, test.effects);
  expect(test.requestTransaction).toHaveBeenCalledTimes(1);
  const btcHash = "cd".repeat(32);
  fetcher.mockResolvedValueOnce(Response.json({ ...nearStatus(test.quote, "SUCCESS"), swapDetails: {
    originChainTxHashes: [{ hash: nearTxHash }], destinationChainTxHashes: [{ hash: btcHash }], amountOut: "97848",
  } }));
  const observed = await nearMonitor.observe(saved, new AbortController().signal);
  test.effects.activities.patch(saved.id, observed.patch);
  const receipt = activityDetailFor(loadStoredActivities()[0]).receipt;
  expect(receipt.receivedAmount).toBe("0.00097848");
  expect(receipt.destinationLink.href).toBe(`https://mempool.space/tx/${btcHash}`);
});

it("rejects a changed Bitcoin recipient before constructing a Miden deposit", async () => {
  const test = setup(true);
  test.input.externalAddress = "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy";
  test.input.externalWallet.address = test.input.externalAddress;
  await submitBridgeTransfer(test.input, test.effects);
  expect(test.effects.onError).toHaveBeenCalledWith("Refresh and review the quote before sending.");
  expect(test.requestTransaction).not.toHaveBeenCalled();
});

it("rechecks the Bitcoin recipient after asynchronous preparation before asking Bread to fund", async () => {
  const test = setup(true);
  test.assertBitcoinAccount.mockRejectedValue(new Error("Bitcoin payment account changed"));
  await submitBridgeTransfer(test.input, test.effects);
  expect(test.effects.onError).toHaveBeenCalledWith("Bitcoin payment account changed");
  expect(test.requestTransaction).not.toHaveBeenCalled();
  expect(loadStoredActivities()).toHaveLength(0);
});

it("records not sent when Bread disconnects while an outbound funding claim is being saved", async () => {
  const test = setup();
  let connected = true;
  const guard = () => { if (!connected) throw new Error("Your Miden wallet changed."); };
  test.input.midenWallet.assertAccount = guard;
  test.input.midenWallet.requestTransaction = request => { guard(); return test.requestTransaction(request); };
  const write = window.localStorage.setItem.bind(window.localStorage);
  vi.spyOn(window.localStorage, "setItem").mockImplementation((key, value) => {
    if (JSON.parse(value)[0]?.near?.submission === "attempted") connected = false;
    write(key, value);
  });
  await submitBridgeTransfer(test.input, test.effects);
  expect(test.requestTransaction).not.toHaveBeenCalled();
  expect(loadStoredActivities()[0].near?.submission).toBe("not_sent");
  expect(test.effects.onError).toHaveBeenCalledWith(expect.stringMatching(/Miden wallet changed/));
});
