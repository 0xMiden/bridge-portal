import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createActivity } from "./bridge-presentation";
import { activityRoute, findBridgeRoute, routesForEnvironment } from "../../bridge/core/routes";
import { currentBridgeConfig } from "../../config/bridge-config";
import {
  activityStorageKey, loadStoredActivities, loadStoredMode, loadStoredRoute, loadStoredRouteId,
  patchStoredActivity, saveActivities, saveStoredMode, saveStoredRoute,
} from "./bridge-persistence";

const activity = createActivity(findBridgeRoute("agglayer-eth-to-sepolia")!, "1", {
  id: "act-test", status: "source_finality", depositCount: "42", updatedAt: 1_700_000_000_000,
  agglayerExitHashes: [`0x${"ab".repeat(32)}`],
});
let storage: Map<string, string>;
beforeEach(() => {
  storage = new Map();
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
  patchStoredActivity(mainnet.id, { status: "complete", claimTxHash: "0xclaim", agglayerExitHashes: [`0x${"ab".repeat(32)}`] });
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

it("persists and patches receipt progress without losing acknowledged transaction metadata", () => {
  const other = { ...activity, id: "other" };
  saveActivities([activity, other]);
  vi.spyOn(Date, "now").mockReturnValue(1_700_000_100_000);
  patchStoredActivity(activity.id, { status: "complete", destinationTxHash: "0xarrival" });
  patchStoredActivity(activity.id, { status: "source_finality", destinationTxHash: undefined });
  expect(loadStoredActivities()).toMatchObject([
    { id: activity.id, status: "complete", destinationTxHash: "0xarrival", destinationTxAt: 1_700_000_100_000, updatedAt: 1_700_000_100_000 }, { id: other.id, status: other.status },
  ]);
});

it.each([null, "", "null", "{}"])("returns no receipts for absent or non-array data: %s", raw => {
  if (raw !== null) storage.set(activityStorageKey, raw);
  expect(loadStoredActivities()).toEqual([]);
});

it("leaves malformed storage available for callers to diagnose and does not overwrite it on a patch", () => {
  storage.set(activityStorageKey, "{broken");
  expect(() => loadStoredActivities()).toThrow(SyntaxError);
  expect(() => patchStoredActivity(activity.id, { status: "complete" })).not.toThrow();
  expect(storage.get(activityStorageKey)).toBe("{broken");
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

it("propagates receipt write errors while tolerating preference and patch write errors", () => {
  saveActivities([activity]);
  vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new Error("Storage full"); });
  expect(() => saveActivities([])).toThrow("Storage full");
  expect(() => saveStoredRoute("epoch")).not.toThrow();
  expect(() => saveStoredMode("send")).not.toThrow();
  expect(() => patchStoredActivity(activity.id, { status: "complete" })).not.toThrow();
  expect(loadStoredActivities()).toEqual([activity]);
});
