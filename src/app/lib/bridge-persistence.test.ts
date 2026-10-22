import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Activity } from "./bridge-presentation";
import { createActivity } from "./bridge-presentation";
import { activityRoute, routesForEnvironment } from "../../bridge/core/routes";
import {
  loadStoredActivities,
  loadStoredMode,
  loadStoredRoute,
  patchStoredActivity,
  saveActivities,
  saveStoredMode,
  saveStoredRoute,
} from "./bridge-persistence";

const activity: Activity = {
  id: "act-test",
  mode: "send",
  provider: "agglayer",
  summary: "Send 1 ETH to Sepolia",
  status: "source_finality",
  eta: "8 min",
  amount: "1",
  asset: "ETH",
  txHash: "0xpending",
  depositCount: "42",
  agglayerExitHashes: [`0x${"ab".repeat(32)}`],
  updatedAt: 1_700_000_000_000,
};

let storage: Map<string, string>;

beforeEach(() => {
  storage = new Map();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("activity persistence", () => {
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

  it("resolves explicit and legacy routes without rewriting saved history or guessing unknown tokens", () => {
    const raw = JSON.stringify([
      activity,
      { ...activity, routeId: "epoch-usdc-to-sepolia", provider: "epoch", asset: "USDC" },
      { ...activity, provider: "epoch", asset: "UNKNOWN" },
      { ...activity, routeId: "unknown-route" },
    ]);
    storage.set("miden.bridge.ui.activities", raw);

    expect(loadStoredActivities().map((item) => activityRoute(item)?.id)).toEqual([
      "agglayer-eth-to-sepolia", "epoch-usdc-to-sepolia", undefined, undefined,
    ]);
    expect(storage.get("miden.bridge.ui.activities")).toBe(raw);
  });

  it("keeps the existing key and plain JSON array, including tracking fields", () => {
    const activities: Activity[] = [activity, {
      ...activity,
      id: "epoch-send",
      provider: "epoch",
      asset: "USDC",
      epochIntentNonce: "12345678901234567890",
      epochSponsor: "0x1234",
      midenAccount: "mcst1-account",
      sourceTxHash: "0xsource",
      receivedAmount: "9007199254740993.123456789012345678",
    }];

    saveActivities(activities);

    expect(storage.get("miden.bridge.ui.activities")).toBe(JSON.stringify(activities));
    expect(loadStoredActivities()).toMatchObject(activities);
  });

  it("recovers timestamps written before numeric dates without rewriting saved history", () => {
    const createdAt = 1_700_000_000_000;
    const raw = JSON.stringify([
      { ...activity, id: `act-${createdAt.toString(36)}`, updatedAt: "Just now" },
      { ...activity, id: `act-${createdAt.toString(36)}`, updatedAt: 0 },
      { ...activity, id: "remote-transfer", updatedAt: "Just now" },
    ]);
    storage.set("miden.bridge.ui.activities", raw);

    expect(loadStoredActivities().map(({ updatedAt }) => updatedAt)).toEqual([createdAt, createdAt, 0]);
    expect(storage.get("miden.bridge.ui.activities")).toBe(raw);
  });

  it("ignores unsupported provider and direction names without rewriting stored data", () => {
    const raw = JSON.stringify([
      { ...activity, mode: "deposit" },
      { ...activity, mode: "withdraw" },
      { ...activity, provider: "near-intents" },
      { ...activity, provider: "constructor" },
      activity,
    ]);
    storage.set("miden.bridge.ui.activities", raw);
    expect(loadStoredActivities()).toMatchObject([activity]);
    expect(storage.get("miden.bridge.ui.activities")).toBe(raw);
  });

  it("recovers the failure leg recorded by older monitors at the storage boundary", () => {
    storage.set("miden.bridge.ui.activities", JSON.stringify([
      { ...activity, status: "failed", eta: "Destination transaction failed" },
      { ...activity, status: "failed", failureLeg: "source", eta: "Destination transaction failed" },
    ]));
    expect(loadStoredActivities().map(({ failureLeg }) => failureLeg)).toEqual(["destination", "source"]);
  });

  it("recovers an older Agglayer recipient without replacing an explicitly recorded account", () => {
    const account = "0x387149ae66116cf114eebd60bb7381";
    const bridgeDestinationAddress = `0x00000000${account.slice(2)}00`;
    storage.set("miden.bridge.ui.activities", JSON.stringify([
      { ...activity, mode: "receive", bridgeDestinationAddress },
      { ...activity, mode: "receive", bridgeDestinationAddress, midenAccountHex: "0xexplicit" },
    ]));
    expect(loadStoredActivities().map(({ midenAccountHex }) => midenAccountHex)).toEqual([account, "0xexplicit"]);
  });

  it("loads legacy received amounts without changing their value or token", () => {
    storage.set("miden.bridge.ui.activities", JSON.stringify([
      { ...activity, receivedAmount: "0.005 ETH" },
      { ...activity, asset: "USDC", receivedAmount: "0.999 USDC" },
      { ...activity, receivedAmount: "9007199254740993.123456789012345678" },
      activity,
      { ...activity, receivedAmount: "1 USDC" },
    ]));

    expect(loadStoredActivities().map(({ receivedAmount, asset }) => ({ receivedAmount, asset }))).toEqual([
      { receivedAmount: "0.005", asset: "ETH" },
      { receivedAmount: "0.999", asset: "USDC" },
      { receivedAmount: "9007199254740993.123456789012345678", asset: "ETH" },
      { receivedAmount: undefined, asset: "ETH" },
      { receivedAmount: "1 USDC", asset: "ETH" },
    ]);
  });

  it.each([null, "", "null", "{}"])("returns an empty list for absent or non-array data: %s", (raw) => {
    if (raw !== null) storage.set("miden.bridge.ui.activities", raw);
    expect(loadStoredActivities()).toEqual([]);
  });

  it("patches only the matching persisted activity and stamps the update time", () => {
    const now = 1_700_000_100_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const other = { ...activity, id: "other" };
    storage.set("miden.bridge.ui.activities", JSON.stringify([activity, other]));

    patchStoredActivity(activity.id, { status: "complete", claimTxHash: "0xclaim", updatedAt: 1 });
    patchStoredActivity("missing", { status: "failed" });

    expect(JSON.parse(storage.get("miden.bridge.ui.activities")!)).toMatchObject([
      { ...activity, status: "complete", claimTxHash: "0xclaim", destinationTxAt: now, updatedAt: now },
      other,
    ]);
  });

  it("leaves malformed JSON for callers to handle and skips failed patches", () => {
    storage.set("miden.bridge.ui.activities", "{broken");

    expect(() => loadStoredActivities()).toThrow(SyntaxError);
    expect(() => patchStoredActivity(activity.id, { status: "complete" })).not.toThrow();
    expect(storage.get("miden.bridge.ui.activities")).toBe("{broken");
  });

  it("keeps the latest provider phase when an older observation arrives, while accepting late metadata", () => {
    saveActivities([{ ...activity, provider: "xreserve", mode: "receive", xreserveStatus: "confirmed" }]);
    patchStoredActivity(activity.id, { xreserveStatus: "submitted", xreserveForwarding: true, sourceTxHash: "0xsource" });
    expect(loadStoredActivities()[0]).toMatchObject({ status: "source_finality", xreserveStatus: "confirmed", sourceTxHash: "0xsource" });

    patchStoredActivity(activity.id, { xreserveStatus: "attested" });
    patchStoredActivity(activity.id, { status: "complete", xreserveStatus: "delivered" });
    patchStoredActivity(activity.id, { status: "failed", xreserveStatus: "reverted", xreserveNoteId: "delivered-note" });
    expect(loadStoredActivities()[0]).toMatchObject({ status: "complete", xreserveStatus: "delivered", xreserveNoteId: "delivered-note" });
  });

  it("keeps the acknowledged source when a later solver response omits it", () => {
    saveActivities([{ ...activity, provider: "epoch", asset: "USDC", sourceTxHash: "0xsource", midenTxId: "collateral-note" }]);
    patchStoredActivity(activity.id, { status: "message_observed", epochIntentNonce: "42", sourceTxHash: undefined, midenTxId: undefined });
    expect(loadStoredActivities()[0]).toMatchObject({
      status: "message_observed", epochIntentNonce: "42", sourceTxHash: "0xsource", midenTxId: "collateral-note",
    });
  });

  it("does not stamp arrival when a Miden send records its source transaction", () => {
    saveActivities([activity]);
    patchStoredActivity(activity.id, { midenTxId: "0xmiden-source" });
    expect(loadStoredActivities()[0].destinationTxAt).toBeUndefined();
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_100_000);
    patchStoredActivity(activity.id, { destinationTxHash: "0xevm-destination", status: "complete" });
    expect(loadStoredActivities()[0].destinationTxAt).toBe(1_700_000_100_000);
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_200_000);
    patchStoredActivity(activity.id, { status: "source_finality" });
    expect(loadStoredActivities()[0]).toMatchObject({ status: "complete", destinationTxAt: 1_700_000_100_000 });
  });
});

describe("route and direction preferences", () => {
  it("saves testnet preferences separately with unencoded values", () => {
    for (const route of ["xreserve", "agglayer", "epoch"] as const) {
      saveStoredRoute(route);
      expect(storage.get("miden.bridge.ui.route.testnet")).toBe(route);
      expect(loadStoredRoute()).toBe(route);
    }
    for (const mode of ["send", "receive"] as const) {
      saveStoredMode(mode);
      expect(storage.get("miden.bridge.ui.mode.testnet")).toBe(mode);
      expect(loadStoredMode()).toBe(mode);
    }
  });

  it.each([null, "", "near-intents", "unknown", "constructor", "__proto__"])("ignores an absent, disabled, or unknown route: %s", (route) => {
    if (route !== null) storage.set("miden.bridge.ui.route", route);
    expect(loadStoredRoute()).toBeNull();
  });

  it.each([null, "", "deposit", "withdraw", "unknown"])("ignores an absent or invalid direction preference: %s", (mode) => {
    if (mode !== null) storage.set("miden.bridge.ui.mode", mode);
    expect(loadStoredMode()).toBeNull();
  });
});

describe("storage failures", () => {
  it.each(["SSR", "blocked storage"])("preserves caller error handling with %s", (scenario) => {
    vi.stubGlobal("window", scenario === "SSR" ? undefined : {
      get localStorage() { throw new Error("Storage blocked"); },
    });

    expect(loadStoredRoute()).toBeNull();
    expect(loadStoredMode()).toBeNull();
    expect(() => saveStoredRoute("epoch")).not.toThrow();
    expect(() => saveStoredMode("send")).not.toThrow();
    expect(() => patchStoredActivity(activity.id, { status: "complete" })).not.toThrow();
    expect(() => loadStoredActivities()).toThrow();
    expect(() => saveActivities([activity])).toThrow();
  });

  it("propagates activity write errors but tolerates preference and patch write errors", () => {
    storage.set("miden.bridge.ui.activities", JSON.stringify([activity]));
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("Storage full");
    });

    expect(() => saveActivities([])).toThrow("Storage full");
    expect(() => saveStoredRoute("epoch")).not.toThrow();
    expect(() => saveStoredMode("send")).not.toThrow();
    expect(() => patchStoredActivity(activity.id, { status: "complete" })).not.toThrow();
    expect(loadStoredActivities()).toMatchObject([activity]);
  });
});

describe("coexisting networks", () => {
  it("keeps legacy transfers on testnet while saving and updating a mainnet receipt", () => {
    storage.set("miden.bridge.ui.activities", JSON.stringify([activity]));
    storage.set("miden.bridge.ui.route", "epoch");
    storage.set("miden.bridge.ui.mode", "send");
    expect(loadStoredRoute("testnet")).toBe("epoch");
    expect(loadStoredMode("testnet")).toBe("send");
    expect(loadStoredRoute("mainnet")).toBeNull();
    expect(loadStoredMode("mainnet")).toBeNull();
    const route = routesForEnvironment("mainnet").find(route => route.provider === "agglayer" && route.mode === "send")!;
    const mainnet = createActivity(route, "0.01");
    saveActivities([mainnet, ...loadStoredActivities()]);
    saveStoredRoute("agglayer", route.id, "mainnet");
    saveStoredMode("receive", "mainnet");
    patchStoredActivity(mainnet.id, { agglayerExitHashes: [`0x${"ab".repeat(32)}`], claimTxHash: "0xmainnetclaim", status: "complete" });
    const testnet = loadStoredActivities("testnet");
    expect(testnet).toHaveLength(1);
    expect(testnet[0]).toMatchObject({ ...activity, environment: "testnet", routeSnapshot: {
      source: { network: "miden-testnet", faucetId: "0x7c6d1dc7fb7045913d524bbef017f5" },
      destination: { network: "sepolia" },
    } });
    expect(loadStoredActivities("mainnet")).toMatchObject([{ id: mainnet.id, status: "complete", routeSnapshot: {
      source: { network: "miden-mainnet", faucetId: "0x419f8f4bff72959132aa7cea15a4c1" },
      destination: { network: "ethereum" },
    } }]);
    expect(loadStoredActivities()).toHaveLength(2);
    expect(loadStoredMode("testnet")).toBe("send");
    expect(loadStoredRoute("testnet")).toBe("epoch");
  });
});
