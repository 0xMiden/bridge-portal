import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { submitBridgeTransfer, type TransferSubmission } from "../../../app/lib/bridge-submission";
import { activityPersistence, loadStoredActivities } from "../../../app/lib/bridge-persistence";
import { activityDetailFor } from "../../../app/lib/activity-detail-presentation";
import { ActivityStore } from "../../activity";
import { findBridgeRoute } from "../../core/routes";
import { nearQuoteResult } from "./quote";
import { nearMonitor } from "./tracking";
import { bitcoinReceiveInput, nearQuoteFixture, nearStatus, nearTxHash } from "../../../../test/near-quotes";

vi.mock("@defuse-protocol/one-click-sdk-typescript", async importOriginal => ({
  ...await importOriginal<typeof import("@defuse-protocol/one-click-sdk-typescript")>(),
  verifyQuoteSignature: vi.fn(() => true),
}));

const fetcher = vi.fn<typeof fetch>();
beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("window", { localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  } });
  vi.stubGlobal("navigator", { locks: { request: async (_name: string, callback: () => Promise<void>) => callback() } });
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockReset();
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

function setup() {
  const route = findBridgeRoute(bitcoinReceiveInput.routeId)!;
  const quote = nearQuoteFixture(bitcoinReceiveInput, false, { amountOut: "98248", minAmountOut: "97265" });
  const accounts = { midenAccount: bitcoinReceiveInput.midenAccount, externalAddress: bitcoinReceiveInput.externalAddress };
  const walletRequest = vi.fn();
  const sendTransfer = vi.fn().mockResolvedValue("ab".repeat(32));
  const assertAccount = vi.fn().mockResolvedValue(undefined);
  const input: TransferSubmission = {
    ...accounts, routeId: route.id, environment: "mainnet", amount: "0.001",
    insufficientBalance: false, sourceBalance: "", midenAsset: null,
    quote: { ...nearQuoteResult(quote, route.id), request: { ...accounts, amount: "0.001", routeId: route.id, recovery: route.recovery } },
    externalWallet: { family: "bitcoin", connected: true, address: accounts.externalAddress, assertAccount,
      provider: { sendTransfer, getAccountAddresses: vi.fn() } },
    midenWallet: { connected: true, address: accounts.midenAccount, requestTransaction: walletRequest },
  };
  const effects = { openExternalWallet: vi.fn(), onError: vi.fn(), onSubmittingChange: vi.fn(), onPhaseChange: vi.fn(),
    verifyBalanceCap: vi.fn(), activities: new ActivityStore(activityPersistence), navigate: vi.fn() };
  effects.activities.sync();
  fetcher.mockImplementation(async path => {
    if (String(path).endsWith("prepare")) return Response.json(quote);
    return Response.json(nearStatus(quote));
  });
  return { input, effects, quote, walletRequest, sendTransfer, assertAccount };
}

it("saves the attempt before one Bitcoin payment, resumes after reload and tracks native hashes through delivery", async () => {
  const test = setup();
  test.sendTransfer.mockImplementation(async () => {
    expect(loadStoredActivities()[0]).toMatchObject({ near: { submission: "attempted", status: "PENDING_DEPOSIT" } });
    return "ab".repeat(32);
  });
  fetcher.mockImplementation(async path => String(path).endsWith("prepare") ? Response.json(test.quote)
    : Response.json({ error: "Temporary outage" }, { status: 503 }));
  await submitBridgeTransfer(test.input, test.effects);
  expect(test.effects.onError).not.toHaveBeenCalled();
  expect(test.effects.verifyBalanceCap).toHaveBeenCalledWith(findBridgeRoute(test.input.routeId), "0.001", test.input.midenAccount);
  expect(test.walletRequest).not.toHaveBeenCalled();
  expect(test.effects.openExternalWallet).not.toHaveBeenCalled();
  const saved = loadStoredActivities()[0];
  expect(saved).toMatchObject({ destination: test.input.midenAccount, near: { quote: { quoteRequest: { refundTo: test.input.externalAddress } } } });
  expect(saved).toMatchObject({ sourceTxHash: "ab".repeat(32), near: { submission: "accepted", notification: "pending" } });
  expect(test.sendTransfer).toHaveBeenCalledExactlyOnceWith({ recipient: test.quote.quote.depositAddress, amount: "100000" });
  test.effects.activities = new ActivityStore(activityPersistence);
  test.effects.activities.sync();
  await submitBridgeTransfer(test.input, test.effects);
  expect(loadStoredActivities()).toHaveLength(1);
  expect(test.sendTransfer).toHaveBeenCalledTimes(1);
  fetcher.mockImplementation(async path => String(path).endsWith("status") ? Response.json(nearStatus(test.quote)) : Response.json({}));
  const notified = await nearMonitor.observe(saved, new AbortController().signal);
  test.effects.activities.patch(saved.id, notified.patch);
  expect(loadStoredActivities()[0].near?.notification).toBe("sent");

  const btcHash = "ab".repeat(32);
  for (const status of ["KNOWN_DEPOSIT_TX", "SUCCESS"] as const) {
    fetcher.mockResolvedValueOnce(Response.json({ ...nearStatus(test.quote, status), swapDetails: {
      originChainTxHashes: [{ hash: btcHash }], destinationChainTxHashes: status === "SUCCESS" ? [{ hash: nearTxHash }] : [],
      amountOut: "98248",
    } }));
    const observation = await nearMonitor.observe(loadStoredActivities()[0], new AbortController().signal);
    expect(observation.warning).toBeUndefined();
    test.effects.activities.patch(saved.id, observation.patch);
  }
  const completed = loadStoredActivities()[0];
  expect(completed).toMatchObject({ status: "complete", sourceTxHash: btcHash, midenTxId: nearTxHash, receivedAmount: "0.00098248" });
  expect(activityDetailFor(completed).receipt.sourceLink.href).toBe(`https://mempool.space/tx/${btcHash}`);
  expect(nearMonitor.canPoll(completed)).toBe(false);
  expect(test.sendTransfer).toHaveBeenCalledTimes(1);
});

it.each(["storage", "cap", "refund-address", "quote-address", "expired", "disconnected", "account-changed", "account-changed-during-prepare"] as const)("blocks the Bitcoin payment on %s failure", async failure => {
  const test = setup();
  if (failure === "storage") vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new Error("Quota"); });
  if (failure === "cap") test.effects.verifyBalanceCap.mockRejectedValue(new Error("Balance limit exceeded"));
  if (failure === "refund-address") {
    test.input.externalAddress = "bc1invalid";
    test.input.externalWallet.address = test.input.externalAddress;
  }
  if (failure === "quote-address") test.quote.quote.depositAddress = "0x3333333333333333333333333333333333333333";
  if (failure === "expired") { vi.useFakeTimers(); vi.advanceTimersByTime(11 * 60_000); }
  if (failure === "disconnected") test.input.externalWallet.connected = false;
  if (failure === "account-changed") test.input.externalWallet.address = "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy";
  if (failure === "account-changed-during-prepare") test.assertAccount.mockRejectedValue(new Error("Bitcoin payment account changed"));
  await submitBridgeTransfer(test.input, test.effects);
  if (failure === "disconnected") expect(test.effects.openExternalWallet).toHaveBeenCalledOnce();
  else expect(test.effects.onError).toHaveBeenCalled();
  expect(test.effects.navigate).not.toHaveBeenCalled();
  expect(test.walletRequest).not.toHaveBeenCalled();
  expect(test.sendTransfer).not.toHaveBeenCalled();
});

it.each(["rejected", "lost-response", "invalid-hash"])("retains the attempt after a %s and never repeats its payment", async failure => {
  const test = setup();
  if (failure === "invalid-hash") test.sendTransfer.mockResolvedValue(nearTxHash);
  else test.sendTransfer.mockRejectedValue(new Error(failure));
  await submitBridgeTransfer(test.input, test.effects);
  expect(loadStoredActivities()[0]).toMatchObject({ near: { submission: "attempted" } });
  expect(loadStoredActivities()[0].sourceTxHash).toBeUndefined();
  expect(test.effects.onError).toHaveBeenCalledWith(expect.stringContaining("Check the wallet request"));
  test.effects.activities = new ActivityStore(activityPersistence);
  test.effects.activities.sync();
  await submitBridgeTransfer(test.input, test.effects);
  expect(test.sendTransfer).toHaveBeenCalledTimes(1);
});

it("retains the Bitcoin refund separately and keeps polling incomplete deposits after expiry", async () => {
  const test = setup();
  await submitBridgeTransfer(test.input, test.effects);
  const saved = loadStoredActivities()[0];
  vi.useFakeTimers(); vi.advanceTimersByTime(61 * 60_000);
  fetcher.mockResolvedValueOnce(Response.json(nearStatus(test.quote, "INCOMPLETE_DEPOSIT")));
  const incomplete = await nearMonitor.observe(saved, new AbortController().signal);
  test.effects.activities.patch(saved.id, incomplete.patch);
  expect(nearMonitor.canPoll(loadStoredActivities()[0])).toBe(true);
  fetcher.mockResolvedValueOnce(Response.json({ ...nearStatus(test.quote, "REFUNDED"), swapDetails: {
    originChainTxHashes: [{ hash: "cd".repeat(32) }], destinationChainTxHashes: [], refundedAmount: "98000",
  } }));
  const refund = await nearMonitor.observe(loadStoredActivities()[0], new AbortController().signal);
  test.effects.activities.patch(saved.id, refund.patch);
  const activity = loadStoredActivities()[0];
  expect(activity.sourceTxHash).toBe("ab".repeat(32));
  expect(activityDetailFor(activity)).toMatchObject({
    receipt: { receivedAmount: "0", refund: "0.00098 BTC" },
    guidance: { title: "Refunded to your source wallet" },
  });
});

it("does not accept an EVM-formatted Bitcoin transaction as detected funding", async () => {
  const test = setup();
  await submitBridgeTransfer(test.input, test.effects);
  const saved = loadStoredActivities()[0];
  fetcher.mockResolvedValueOnce(Response.json({ ...nearStatus(test.quote, "SUCCESS"), swapDetails: {
    originChainTxHashes: [{ hash: nearTxHash }], destinationChainTxHashes: [{ hash: nearTxHash }],
  } }));
  const observation = await nearMonitor.observe(saved, new AbortController().signal);
  test.effects.activities.patch(saved.id, observation.patch);
  expect(loadStoredActivities()[0].near?.status).toBe("PENDING_DEPOSIT");
  expect(observation.warning).toMatch(/remains pending/);
});

it("rechecks expiry after the live wallet account check and before requesting payment", async () => {
  const test = setup();
  vi.useFakeTimers();
  test.assertAccount.mockImplementation(async () => { vi.advanceTimersByTime(11 * 60_000); });
  await submitBridgeTransfer(test.input, test.effects);
  expect(test.effects.onError).toHaveBeenCalledWith(expect.stringMatching(/expired/));
  expect(test.sendTransfer).not.toHaveBeenCalled();
  expect(loadStoredActivities()).toHaveLength(0);
});
