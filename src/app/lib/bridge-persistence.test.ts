import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Activity } from "./bridge-presentation";
import { activityRoute } from "../../bridge/core/routes";
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
  it("resolves explicit and legacy routes without rewriting saved history or guessing unknown tokens", () => {
    const raw = JSON.stringify([
      { ...activity, mode: "withdraw" },
      { ...activity, routeId: "epoch-usdc-to-sepolia", provider: "epoch", asset: "USDC" },
      { ...activity, provider: "epoch", asset: "DAI" },
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
    expect(loadStoredActivities()).toEqual(activities);
  });

  it("normalizes legacy directions, summaries, and timestamps on read only", () => {
    const createdAt = 1_700_000_000_000;
    const raw = JSON.stringify([
      { ...activity, id: `act-${createdAt.toString(36)}`, mode: "deposit", summary: "Deposit 1 ETH to Miden", updatedAt: "Just now" },
      { ...activity, mode: "withdraw", summary: "Withdraw 1 ETH to Sepolia" },
      { ...activity, mode: "receive", summary: "Receive 1 ETH to Miden", updatedAt: "Just now" },
      { ...activity, id: `act-${createdAt.toString(36)}`, updatedAt: 0 },
      { ...activity, id: "remote-transfer", updatedAt: "Just now" },
    ]);
    storage.set("miden.bridge.ui.activities", raw);

    expect(loadStoredActivities().map(({ mode, summary, updatedAt }) => ({ mode, summary, updatedAt }))).toEqual([
      { mode: "receive", summary: "Receive 1 ETH on Miden", updatedAt: createdAt },
      { mode: "send", summary: "Send 1 ETH to Sepolia", updatedAt: createdAt },
      { mode: "receive", summary: "Receive 1 ETH on Miden", updatedAt: 0 },
      { mode: "send", summary: "Send 1 ETH to Sepolia", updatedAt: createdAt },
      { mode: "send", summary: "Send 1 ETH to Sepolia", updatedAt: 0 },
    ]);
    expect(storage.get("miden.bridge.ui.activities")).toBe(raw);
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

    expect(JSON.parse(storage.get("miden.bridge.ui.activities")!)).toEqual([
      { ...activity, status: "complete", claimTxHash: "0xclaim", updatedAt: now },
      other,
    ]);
  });

  it("leaves malformed JSON for callers to handle and skips failed patches", () => {
    storage.set("miden.bridge.ui.activities", "{broken");

    expect(() => loadStoredActivities()).toThrow(SyntaxError);
    expect(() => patchStoredActivity(activity.id, { status: "complete" })).not.toThrow();
    expect(storage.get("miden.bridge.ui.activities")).toBe("{broken");
  });
});

describe("route and direction preferences", () => {
  it("keeps the existing keys and unencoded preference values", () => {
    for (const route of ["xreserve", "agglayer"] as const) {
      saveStoredRoute(route);
      expect(storage.get("miden.bridge.ui.route")).toBe(route);
      expect(loadStoredRoute()).toBe(route);
    }
    for (const mode of ["send", "receive"] as const) {
      saveStoredMode(mode);
      expect(storage.get("miden.bridge.ui.mode")).toBe(mode);
      expect(loadStoredMode()).toBe(mode);
    }
  });

  it.each([null, "", "near-intents", "epoch", "unknown"])("ignores an absent, disabled, or unknown route: %s", (route) => {
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
    expect(loadStoredActivities()).toEqual([activity]);
  });
});
