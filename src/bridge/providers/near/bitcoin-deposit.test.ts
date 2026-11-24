import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { submitBridgeTransfer, type TransferSubmission } from "../../../app/lib/bridge-submission";
import { activityPersistence, activityStorageKey, loadStoredActivities, saveActivities } from "../../../app/lib/bridge-persistence";
import { activityDetailFor } from "../../../app/lib/activity-detail-presentation";
import { ActivityStore } from "../../activity";
import { observeActivity } from "../../tracking";
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

function setup(binding = bitcoinReceiveInput) {
  const route = findBridgeRoute(binding.routeId)!;
  const quote = nearQuoteFixture(binding, false, { amountOut: "98248", minAmountOut: "97265" });
  const accounts = { midenAccount: binding.midenAccount, externalAddress: binding.externalAddress };
  const walletRequest = vi.fn();
  const sendTransfer = vi.fn().mockResolvedValue("ab".repeat(32));
  const assertAccount = vi.fn().mockResolvedValue(undefined);
  const input: TransferSubmission = {
    ...accounts, routeId: route.id, environment: "mainnet", amount: "0.001",
    insufficientBalance: false, sourceBalance: "", midenAsset: null,
    quote: { ...nearQuoteResult(quote, route.id), request: { ...accounts, amount: "0.001", routeId: route.id, recovery: route.recovery } },
    externalWallet: { family: "bitcoin", connected: true, address: accounts.externalAddress, assertAccount,
      provider: { sendTransfer, getAccountAddresses: vi.fn() } },
    midenWallet: { connected: true, address: accounts.midenAccount, assertAccount: vi.fn(), requestTransaction: walletRequest },
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
  vi.useFakeTimers({ toFake: ["Date"] });
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
  vi.setSystemTime(Date.now() + 30_000);
  const notified = await nearMonitor.observe(saved, new AbortController().signal);
  test.effects.activities.patch(saved.id, notified.patch);
  expect(loadStoredActivities()[0].near?.notification).toBe("sent");

  const btcHash = "cd".repeat(32); // The wallet transaction was replaced before confirmation.
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
  expect(completed).toMatchObject({ status: "complete", sourceTxHash: btcHash, sourceOriginalTxHash: "ab".repeat(32), midenTxId: nearTxHash });
  expect(activityDetailFor(completed).receipt.receivedAmount).toBe("0.00098248");
  expect(activityDetailFor(completed).receipt.sourceLink.href).toBe(`https://mempool.space/tx/${btcHash}`);
  expect(nearMonitor.canPoll(completed)).toBe(false);
  expect(test.sendTransfer).toHaveBeenCalledTimes(1);
});

it("can refresh missing settlement evidence after reload without polling a completed transfer indefinitely", async () => {
  const test = setup();
  await submitBridgeTransfer(test.input, test.effects);
  const saved = loadStoredActivities()[0];
  expect(activityDetailFor(saved).receipt).toMatchObject({ receivedLabel: "Expected", receivedAmount: "0.00098248" });
  fetcher.mockResolvedValueOnce(Response.json(nearStatus(test.quote, "SUCCESS")));
  const observation = await nearMonitor.observe(saved, new AbortController().signal);
  test.effects.activities.patch(saved.id, observation.patch);
  const [reloaded] = loadStoredActivities();
  const detail = activityDetailFor(reloaded);
  expect(detail.receipt).toMatchObject({ receivedLabel: "Received", receivedAmount: "—" });
  expect(detail.progress).toMatchObject({ canRefresh: true });
  const signal = new AbortController().signal;
  expect(await observeActivity(reloaded, signal)).toBeNull();
  fetcher.mockResolvedValueOnce(Response.json({ ...nearStatus(test.quote, "SUCCESS"), swapDetails: {
    originChainTxHashes: [], destinationChainTxHashes: [{ hash: nearTxHash }], amountOut: "97123",
  } }));
  const fresh = await observeActivity(reloaded, signal, true);
  test.effects.activities.patch(reloaded.id, fresh!.patch);
  const [settled] = loadStoredActivities();
  expect(settled).toMatchObject({ destinationTxHash: nearTxHash, receivedAmount: "0.00097123" });
  expect(activityDetailFor(settled).progress).toMatchObject({ canRefresh: false });
  expect(await observeActivity(settled, signal, true)).toBeNull();
});

it("keeps the durable receipt unchanged when two tabs observe the same pending status", async () => {
  vi.useFakeTimers();
  const test = setup();
  await submitBridgeTransfer(test.input, test.effects);
  const [saved] = loadStoredActivities();
  const reply = { ...nearStatus(test.quote, "KNOWN_DEPOSIT_TX"), swapDetails: {
    originChainTxHashes: [{ hash: "ab".repeat(32) }], destinationChainTxHashes: [],
  } };
  fetcher.mockImplementation(async () => Response.json(reply));
  const signal = new AbortController().signal;
  const first = await observeActivity(saved, signal);
  test.effects.activities.patch(saved.id, first!.patch);
  const peer = new ActivityStore(activityPersistence);
  await peer.sync();
  const write = vi.spyOn(window.localStorage, "setItem");
  vi.advanceTimersByTime(5_000);
  const repeated = await observeActivity(peer.get(saved.id)!.activity, signal);
  peer.patch(saved.id, repeated!.patch);
  expect(write).not.toHaveBeenCalled();
  expect(loadStoredActivities()[0].updatedAt).toBe(saved.updatedAt);
});

it("keeps the wallet hash if settlement does not identify which deposit was mined", async () => {
  const test = setup();
  await submitBridgeTransfer(test.input, test.effects);
  for (const state of ["KNOWN_DEPOSIT_TX", "SUCCESS"] as const) {
    const [receipt] = loadStoredActivities();
    fetcher.mockResolvedValueOnce(Response.json({ ...nearStatus(test.quote, state), swapDetails: {
      originChainTxHashes: state === "KNOWN_DEPOSIT_TX" ? [{ hash: "cd".repeat(32) }] : [], destinationChainTxHashes: [],
    } }));
    const observed = await nearMonitor.observe(receipt, new AbortController().signal);
    test.effects.activities.patch(receipt.id, observed.patch);
  }
  expect(loadStoredActivities()[0].sourceTxHash).toBe("ab".repeat(32));
});

it("refreshes an ambiguous amount on a completed receipt saved by an older portal", async () => {
  const test = setup();
  await submitBridgeTransfer(test.input, test.effects);
  const [old] = loadStoredActivities();
  saveActivities([{ ...old, receivedAmount: "0.00098248", near: { ...old.near!, status: "SUCCESS" } }]);
  test.effects.activities.sync();
  const receipt = loadStoredActivities()[0];
  expect(activityDetailFor(receipt).receipt.receivedAmount).toBe("—");
  expect(nearMonitor.canPoll(receipt)).toBe(true);
  fetcher.mockResolvedValueOnce(Response.json({ ...nearStatus(test.quote, "SUCCESS"), swapDetails: {
    originChainTxHashes: [], destinationChainTxHashes: [], amountOut: "98248",
  } }));
  const observation = await nearMonitor.observe(receipt, new AbortController().signal);
  test.effects.activities.patch(receipt.id, observation.patch);
  const [refreshed] = loadStoredActivities();
  expect(activityDetailFor(refreshed).receipt.receivedAmount).toBe("0.00098248");
  expect(nearMonitor.canPoll(refreshed)).toBe(false);
});

it("saves a definitive wallet refusal as a terminal receipt without asking for the same payment again", async () => {
  const test = setup();
  test.sendTransfer.mockRejectedValueOnce(Object.assign(new Error("User rejected the request"), { code: 4001 }));
  await submitBridgeTransfer(test.input, test.effects);
  const receipt = loadStoredActivities()[0];
  expect(nearMonitor.canPoll(receipt)).toBe(false);
  expect(activityDetailFor(receipt).guidance?.title).toMatch(/cancelled in your wallet/i);
  await submitBridgeTransfer(test.input, test.effects);
  expect(test.sendTransfer).toHaveBeenCalledTimes(1);
});

it.each([activityStorageKey, "miden.bridge.ui.activities.v2"])("preserves a malformed funding claim in %s across other writes and reload", async key => {
  const test = setup();
  await submitBridgeTransfer(test.input, test.effects);
  const [funded] = loadStoredActivities();
  const damaged = { ...funded, near: { ...funded.near!, networkFee: null } };
  saveActivities([]);
  window.localStorage.setItem(key, JSON.stringify([damaged]));
  const reopened = new ActivityStore(activityPersistence);
  await reopened.sync();
  reopened.record({ ...funded, id: "other-receipt" });
  // An older portal can replace its whole v2 history on its next write.
  window.localStorage.setItem("miden.bridge.ui.activities.v2", "[]");
  test.effects.activities = new ActivityStore(activityPersistence);
  await submitBridgeTransfer(test.input, test.effects);
  expect(test.sendTransfer).toHaveBeenCalledTimes(1);
  expect(test.effects.onError).toHaveBeenCalledWith(expect.stringMatching(/existing receipt could not be checked/i));
  expect(await test.effects.activities.sync("unrelated-quote-id")).toBe(true);
  expect(JSON.parse(window.localStorage.getItem(activityStorageKey)!)).toContainEqual(damaged);
  expect(loadStoredActivities().map(row => row.id)).toEqual(["other-receipt"]);
});

it.each(["WalletStandardConnector", "BitcoinWalletConnectConnector"])("checks %s payment support before saving a funding attempt", async name => {
  const test = setup();
  const entry = import.meta.resolve("@reown/appkit-adapter-bitcoin");
  const { [name]: Connector } = await import(new URL(`../src/connectors/${name}.js`, entry).href);
  const connector = name === "WalletStandardConnector"
    ? new Connector({ wallet: { name: "Read-only wallet", features: { "bitcoin:connect": {} } }, requestedChains: [] })
    : new Connector({ provider: { session: { namespaces: { bip122: { methods: ["getAccountAddresses"] } } } }, chains: [], getActiveChain: () => undefined });
  if (test.input.externalWallet.family !== "bitcoin") throw new Error("Expected Bitcoin wallet");
  test.input.externalWallet.provider = connector;
  const send = vi.spyOn(connector, "sendTransfer");
  await submitBridgeTransfer(test.input, test.effects);
  expect(loadStoredActivities()).toEqual([]);
  expect(send).not.toHaveBeenCalled();
  expect(test.effects.onError).toHaveBeenCalledWith(expect.stringMatching(/supports payments/));
});

it.each([
  { scenario: "a reviewed payment account", path: "m/84'/0'/12'/0/0", version: "6.103.1", pin: 12 },
  { scenario: "a missing derivation path" },
  { scenario: "a Taproot path on a payment record", path: "m/86'/0'/12'/0/0" },
  { scenario: "a child index outside BIP32", path: "m/84'/0'/2147483648'/0/0" },
  { scenario: "Leather Account 1 after a receipt poll", path: "m/84'/0'/0'/0/0", pollDuringCheck: true },
  { scenario: "an extension that overrides a requested account", path: "m/84'/0'/12'/0/0", version: "6.103.0" },
  { scenario: "the mobile wallet that signs with its connected account", path: "m/84'/0'/12'/0/0", mobile: true },
])("checks Leather's native signing account before payment for $scenario", async ({ path, pin, version, mobile, pollDuringCheck }) => {
  const address = "bc1q530dz4h80kwlzywlhx2qn0k6vdtftd93c499yq";
  const test = setup({ ...bitcoinReceiveInput, externalAddress: address });
  const { bitcoin } = await import("@reown/appkit/networks");
  const { ChainController } = await import("@reown/appkit-controllers");
  vi.spyOn(ChainController, "getActiveCaipNetwork").mockReturnValue(bitcoin);
  const send = vi.fn().mockResolvedValue({ result: { txid: "ab".repeat(32) } });
  const getAddresses = vi.fn(async () => {
    const [receipt] = loadStoredActivities();
    if (pollDuringCheck && receipt?.near?.submission === "attempted") {
      const observation = await observeActivity(receipt, new AbortController().signal);
      if (!observation?.patch.near?.statusUpdatedAt) throw new Error("Expected a timestamped receipt poll");
      test.effects.activities.patch(receipt.id, observation.patch);
      await test.effects.activities.sync(receipt.id);
    }
    return { result: { addresses: [
      { symbol: "BTC", type: "p2tr", derivationPath: "m/86'/0'/5'/0/0", address: "ordinal" },
      { symbol: "BTC", type: "p2wpkh", derivationPath: path, address },
    ] } };
  });
  Object.assign(window, {
    LeatherProvider: {
      getProductInfo: () => ({ version: version ?? "6.116.0" }),
      request: (method: string, params: unknown) => method === "getAddresses" ? getAddresses() : send(method, params),
    },
    ...(mobile && { ReactNativeWebView: { postMessage: vi.fn() } }),
  });
  const entry = import.meta.resolve("@reown/appkit-adapter-bitcoin");
  const { LeatherConnector } = await import(new URL("../src/connectors/LeatherConnector.js", entry).href);
  const connector = new LeatherConnector({ connector: { wallet: { id: "LeatherProvider" }, requestedChains: [bitcoin] } });
  if (test.input.externalWallet.family !== "bitcoin") throw new Error("Expected Bitcoin wallet");
  test.input.externalWallet.provider = connector;
  test.assertAccount.mockImplementation(async () => (await connector.getAccountAddresses())[0]);
  await submitBridgeTransfer(test.input, test.effects);
  if (pin !== undefined) {
    expect(send).toHaveBeenCalledExactlyOnceWith("sendTransfer", {
      account: pin, network: "mainnet", recipients: [{ address: test.quote.quote.depositAddress, amount: test.quote.quote.amountIn }],
    });
    expect(getAddresses).toHaveBeenCalledTimes(test.assertAccount.mock.calls.length);
    expect(loadStoredActivities()[0].near?.submission).toBe("accepted");
  } else {
    expect(send).not.toHaveBeenCalled();
    const [receipt] = loadStoredActivities();
    expect(receipt.near?.submission).toBe("not_sent");
    if (pollDuringCheck) expect(receipt.near?.statusUpdatedAt).toBeDefined();
    expect(activityDetailFor(receipt).guidance?.body).toMatch(/Leather.*Account 2.*another Bitcoin wallet/i);
  }
});

it.each([
  ["UniSat", "changed"], ["OKX", "changed"], ["UniSat", "unavailable"], ["OKX", "accepted"],
] as const)("binds the final %s sender read when the account is %s", async (name, outcome) => {
  const test = setup();
  const { ChainController } = await import("@reown/appkit-controllers");
  const { bitcoin } = await import("@reown/appkit/networks");
  vi.spyOn(ChainController, "getActiveCaipNetwork").mockReturnValue(bitcoin);
  const send = vi.fn().mockResolvedValue({ txhash: "ab".repeat(32) });
  const wallet = { getChain: async () => ({ enum: "BITCOIN_MAINNET" }), getAccounts: async () => {
    expect(loadStoredActivities()[0].near?.submission).toBe("attempted");
    if (outcome === "unavailable") throw new Error("Bitcoin accounts unavailable");
    return [outcome === "changed" ? "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy" : test.input.externalAddress];
  }, send, sendBitcoin: send };
  const entry = import.meta.resolve("@reown/appkit-adapter-bitcoin");
  const connector = name === "UniSat"
    ? new (await import(new URL("../src/connectors/UnisatConnector/index.js", entry).href)).UnisatConnector({ id: "unisat", wallet, requestedChains: [bitcoin] })
    : new (await import(new URL("../src/connectors/OKXConnector.js", entry).href)).OKXConnector({ wallet, requestedChains: [bitcoin], requestedCaipNetworkId: bitcoin.caipNetworkId });
  if (test.input.externalWallet.family !== "bitcoin") throw new Error("Expected Bitcoin wallet");
  test.input.externalWallet.provider = connector;
  await submitBridgeTransfer(test.input, test.effects);
  if (outcome === "accepted") {
    expect(send).toHaveBeenCalledExactlyOnceWith({ from: test.input.externalAddress, to: test.quote.quote.depositAddress, value: "0.001" });
    expect(loadStoredActivities()[0].near?.submission).toBe("accepted");
  } else {
    expect(send).not.toHaveBeenCalled();
    expect(loadStoredActivities()[0].near?.submission).toBe("not_sent");
  }
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

it.each(["rejected", "lost-response", "relay rejected the request", "invalid-hash"])("retains the attempt after a %s and never repeats its payment", async failure => {
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

it("stops before payment if storage contention outlasts the reviewed quote", async () => {
  const test = setup();
  vi.useFakeTimers();
  const write = window.localStorage.setItem.bind(window.localStorage);
  vi.spyOn(window.localStorage, "setItem").mockImplementation((key, value) => {
    if (JSON.parse(value)[0]?.near?.submission === "attempted") vi.advanceTimersByTime(11 * 60_000);
    write(key, value);
  });
  await submitBridgeTransfer(test.input, test.effects);
  expect(test.sendTransfer).not.toHaveBeenCalled();
  const [receipt] = loadStoredActivities();
  expect(nearMonitor.canPoll(receipt)).toBe(false);
  expect(activityDetailFor(receipt).guidance?.body).toMatch(/fresh quote/);
});

it.each(["prepare", "funding claim"])("stops the Bitcoin prompt when the Bread recipient disconnects during %s", async when => {
  const test = setup();
  let connected = true;
  test.input.midenWallet.assertAccount = () => { if (!connected) throw new Error("Your Miden wallet changed."); };
  if (when === "prepare") {
    fetcher.mockImplementation(async () => { connected = false; return Response.json(test.quote); });
  } else {
    const write = window.localStorage.setItem.bind(window.localStorage);
    vi.spyOn(window.localStorage, "setItem").mockImplementation((key, value) => {
      if (JSON.parse(value)[0]?.near?.submission === "attempted") connected = false;
      write(key, value);
    });
  }
  await submitBridgeTransfer(test.input, test.effects);
  expect(test.sendTransfer).not.toHaveBeenCalled();
  expect(test.effects.onError).toHaveBeenCalledWith(expect.stringContaining("Miden wallet changed"));
  expect(loadStoredActivities().map(row => row.near?.submission)).toEqual(when === "prepare" ? [] : ["not_sent"]);
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
