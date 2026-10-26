import { ActivityStore } from "../../bridge/activity";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createActivity } from "./bridge-presentation";
import { activityRoute, findBridgeRoute, routesForEnvironment } from "../../bridge/core/routes";
import { currentBridgeConfig } from "../../config/bridge-config";
import {
  activityPersistence, activityStorageKey, loadStoredActivities, loadStoredMode, loadStoredRoute, loadStoredRouteId,
  saveActivities, saveStoredMode, saveStoredRoute,
} from "./bridge-persistence";

const activity = createActivity(findBridgeRoute("agglayer-eth-to-sepolia")!, "1", {
  id: "act-test", status: "source_finality", depositCount: "42", updatedAt: 1_700_000_000_000,
  agglayerExitHashes: [`0x${"ab".repeat(32)}`],
});
let storage: Map<string, string>;
let store: ActivityStore;
beforeEach(() => {
  storage = new Map();
  store = new ActivityStore(activityPersistence);
  vi.stubGlobal("window", { localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  } });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("reopens an unbound completed withdrawal and clears the old claim while preserving its source", () => {
  const source = `0x${"11".repeat(32)}`;
  const oldClaim = `0x${"bb".repeat(32)}`;
  saveActivities([{ ...activity, agglayerExitHashes: undefined, midenTxId: source, status: "complete", depositCount: "1",
    destinationTxHash: oldClaim, claimTxHash: oldClaim, readyForClaim: true, destinationTxAt: 123,
  }]);
  const [recovered] = loadStoredActivities();
  expect(recovered).toMatchObject({ id: activity.id, status: "source_finality", midenTxId: source });
  for (const field of ["depositCount", "destinationTxHash", "claimTxHash", "destinationTxAt", "readyForClaim"] as const)
    expect(recovered[field]).toBeUndefined();
});

it("recovers receipts from an earlier release and keeps both networks separate", () => {
  const route = routesForEnvironment("mainnet").find(route => route.provider === "agglayer" && route.mode === "send")!;
  const historical = structuredClone(route);
  historical.id = "route-no-longer-listed";
  historical.recovery.document.version--;
  historical.recovery.id = `mainnet:${historical.recovery.document.version}`;
  historical.recovery.derived.eth.faucetId = "0x179f749ee2329e317d96fe3ed5aaf9";
  historical.source = { ...historical.source, kind: "miden", network: "miden-mainnet", faucetId: historical.recovery.derived.eth.faucetId };
  const mainnet = createActivity(historical, "0.01", { id: "mainnet-transfer" });
  saveActivities([activity, mainnet]);
  store.sync();
  store.patch(mainnet.id, { status: "complete", claimTxHash: "0xclaim", agglayerExitHashes: [`0x${"ab".repeat(32)}`] });
  const restored = loadStoredActivities("mainnet")[0];
  expect(activityRoute(restored)?.source).toEqual(historical.source);
  expect(activityRoute(restored)?.source).not.toEqual(route.source);
  expect(activityRoute(restored)?.recovery).toEqual(mainnet.routeSnapshot!.recovery);
  expect(restored).toMatchObject({ status: "complete", claimTxHash: "0xclaim" });
  expect(loadStoredActivities("testnet")).toEqual([activity]);
  expect(loadStoredActivities()).toHaveLength(2);
});

it("ignores old history and malformed receipts without guessing a deployment", () => {
  storage.set("miden.bridge.ui.activities", JSON.stringify([{ ...activity, routeSnapshot: undefined }]));
  expect(loadStoredActivities()).toEqual([]);
  const malformed = structuredClone(activity);
  malformed.routeSnapshot!.recovery.document["bridge-providers"].agglayer.indexerUrl = "http://localhost/private";
  saveActivities([malformed, { ...activity, routeSnapshot: undefined }, { ...activity, mode: "receive" }, activity]);
  expect(loadStoredActivities()).toEqual([activity]);
});

it.each([null, "", "null", "{}"])("returns no receipts for absent or non-array data: %s", raw => {
  if (raw !== null) storage.set(activityStorageKey, raw);
  expect(loadStoredActivities()).toEqual([]);
});

describe("route preferences", () => {
  it.each([
    "mainnet:agglayer:ethereum:0x2260fac5e5542a773aa44fbcfedf7c193bc2c599:receive",
    "mainnet:agglayer:ethereum:receive", "mainnet:xreserve:base:send",
  ])("keeps the selected token and direction across releases: %s", id => {
    const original = findBridgeRoute(id)!;
    for (const storedId of [id, id.replace("mainnet:", "mainnet-45e7c7e3b677e8085b946efead24cba2329d8a30:")]) {
      saveStoredRoute(original.provider, storedId, "mainnet");
      expect(loadStoredRouteId("mainnet")).toMatchObject({ id, source: original.source, destination: original.destination, recovery: currentBridgeConfig("mainnet") });
      expect(loadStoredRouteId("testnet")).toBeUndefined();
    }
  });
  it("ignores unknown tokens and routes from the wrong network", () => {
    for (const id of ["mainnet:agglayer:ethereum:UNKNOWN:receive", "agglayer-eth-to-miden"]) {
      storage.set("miden.bridge.ui.route.mainnet.id", id);
      expect(loadStoredRouteId("mainnet")).toBeUndefined();
    }
  });
  it("saves provider and direction independently for each network", () => {
    saveStoredRoute("epoch"); saveStoredMode("send");
    saveStoredRoute("agglayer", undefined, "mainnet"); saveStoredMode("receive", "mainnet");
    expect([loadStoredRoute(), loadStoredMode()]).toEqual(["epoch", "send"]);
    expect([loadStoredRoute("mainnet"), loadStoredMode("mainnet")]).toEqual(["agglayer", "receive"]);
  });
});

it("tolerates preference write failures", () => {
  vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new Error("Storage full"); });
  expect(() => saveStoredRoute("epoch")).not.toThrow();
  expect(() => saveStoredMode("send")).not.toThrow();
});

it.each(["local", "remote"] as const)("merges unsaved fields with another tab's progress when %s confirms delivery", side => {
  saveActivities([activity]);
  store.sync();
  const confirmation = { status: "complete" as const, destinationTxHash: `0x${"cd".repeat(32)}` };
  const metadata = { midenTxId: `0x${"ab".repeat(32)}` };
  const write = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new Error("Storage full"); });
  store.patch(activity.id, side === "local" ? confirmation : metadata);
  // A late observation must not erase an earlier unsaved change.
  store.patch(activity.id, { status: "source_finality", midenTxId: undefined });
  write.mockRestore();

  const otherTab = new ActivityStore(activityPersistence);
  otherTab.sync();
  otherTab.patch(activity.id, side === "local" ? metadata : confirmation);
  store.sync();

  expect(store.get(activity.id)?.activity).toMatchObject({ ...confirmation, ...metadata });
  expect(loadStoredActivities()).toMatchObject([{ id: activity.id, ...confirmation, ...metadata }]);
});

it("persists and patches receipt progress without losing acknowledged transaction metadata", () => {
  const other = { ...activity, id: "other" };
  saveActivities([activity, other]);
  store.sync();
  vi.spyOn(Date, "now").mockReturnValue(1_700_000_100_000);
  store.patch(activity.id, { status: "complete", destinationTxHash: "0xarrival" });
  store.patch(activity.id, { status: "source_finality", destinationTxHash: undefined });
  expect(loadStoredActivities()).toMatchObject([
    { id: activity.id, status: "complete", destinationTxHash: "0xarrival", destinationTxAt: 1_700_000_100_000, updatedAt: 1_700_000_100_000 }, { id: other.id, status: other.status },
  ]);
});

it.each([false, true])("keeps history newest first through late updates and reconciliation (storage unavailable: %s)", unavailable => {
  const older = { ...activity, id: "older", sourceTxAt: 1_700_000_000_000 };
  const newer = { ...activity, id: "newer", sourceTxAt: 1_700_000_001_000 };
  saveActivities([newer, older]);
  store.sync();
  const write = vi.spyOn(window.localStorage, "setItem");
  if (unavailable) write.mockImplementation(() => { throw new Error("Storage full"); });

  store.patch(older.id, { status: "complete", destinationTxHash: "0xarrival" });
  store.record({ ...activity, id: "local", sourceTxAt: 1_700_000_002_000 });
  expect(store.getSnapshot().receipts.map(receipt => receipt.activity.id)).toEqual(["local", "newer", "older"]);
  write.mockRestore();

  const otherTab = new ActivityStore(activityPersistence);
  otherTab.sync();
  otherTab.record({ ...activity, id: "remote", sourceTxAt: 1_700_000_003_000 });
  store.sync();
  expect(store.getSnapshot().receipts.map(receipt => receipt.activity.id)).toEqual(["remote", "local", "newer", "older"]);
  expect(loadStoredActivities().map(receipt => receipt.id)).toEqual(["remote", "local", "newer", "older"]);
});

it("publishes a session receipt while leaving corrupted durable history intact", () => {
  storage.set(activityStorageKey, "{broken");
  store.sync();
  expect(store.getSnapshot()).toMatchObject({ ready: true, receipts: [] });
  store.record(activity);
  store.patch(activity.id, { status: "complete" });
  expect(store.get(activity.id)).toMatchObject({ activity: { id: activity.id, status: "complete" }, unsavedChanges: expect.any(Object) });
  expect(storage.get(activityStorageKey)).toBe("{broken");
});

it("keeps durability per receipt, reconciles another tab, and saves pending progress when storage recovers", () => {
  const other = { ...activity, id: "other-tab" };
  saveActivities([activity, other]);
  store.sync();
  const published = vi.fn();
  store.subscribe(() => published(store.get(activity.id)));
  let publishedAtWrite: unknown;
  const setItem = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
    publishedAtWrite = published.mock.lastCall?.[0];
    throw new Error("Storage full");
  });
  store.patch(activity.id, { status: "complete", destinationTxHash: "0xarrival" });
  // Assert outside the throwing adapter so the store cannot swallow a failed assertion.
  expect(publishedAtWrite).toMatchObject({
    activity: { status: "complete", destinationTxHash: "0xarrival" }, unsavedChanges: expect.any(Object),
  });
  expect(JSON.parse(storage.get(activityStorageKey)!)).toEqual([activity, other]);
  expect(store.get(activity.id)?.unsavedChanges).toBeDefined();
  expect(store.get(other.id)?.unsavedChanges).toBeUndefined();

  const remote = { ...other, summary: "Updated in another tab" };
  storage.set(activityStorageKey, JSON.stringify([activity, remote]));
  store.sync();
  expect(store.get(other.id)?.activity).toEqual(remote);
  expect(store.get(activity.id)?.activity).toMatchObject({ status: "complete", destinationTxHash: "0xarrival" });

  setItem.mockRestore();
  store.sync();
  expect(store.get(activity.id)?.unsavedChanges).toBeUndefined();
  const reloaded = new ActivityStore(activityPersistence);
  reloaded.sync();
  expect(reloaded.getSnapshot()).toEqual(store.getSnapshot());
  expect(reloaded.get(activity.id)?.activity).toMatchObject({ status: "complete", destinationTxHash: "0xarrival" });
});
