import { receiptRouteSchema } from "../../bridge/core/receipt-route";
import { bridgeProviders } from "../../bridge/providers/registry";
import { applyActivityPatch, normalizeActivityState, type ActivityPersistence } from "../../bridge/activity";
import { activityStartedAt } from "../../bridge/core/rules";
import { routeEnvironment, routesForEnvironment } from "../../bridge/core/routes";
import { isFlowMode, type BridgeProvider, type FlowMode } from "../../bridge/core/models";
import { isBridgeProvider } from "../../bridge/providers/registry";
import { type Activity } from "./bridge-presentation";

import type { BridgeEnvironment } from "../../config/environment";
import { nearMidenAddress, nearOperationSchema } from "../../bridge/providers/near/schema";
import { awaitsNearDeposit, nearExpectedAmount } from "../../bridge/providers/near/operation";
import { isEvmAsset } from "../../bridge/core/assets";
import { normalizeMidenAccountHex } from "../../bridge/miden-address";

export const activityStorageKey = "miden.bridge.ui.activities.v3";
const legacyActivityStorageKey = "miden.bridge.ui.activities.v2";

export function isActivityStorageEvent(key: string | null) {
  return key === null || key === activityStorageKey || key === legacyActivityStorageKey;
}

// Persist the last-selected route so a refresh returns to it (e.g. Agglayer)
// instead of snapping back to the default every time.
const routeStorageKey = "miden.bridge.ui.route";

export function loadStoredRoute(environment: BridgeEnvironment = "testnet"): BridgeProvider | null {
  try {
    const value = window.localStorage.getItem(`${routeStorageKey}.${environment}`) ?? (environment === "testnet" ? window.localStorage.getItem(routeStorageKey) : null);
    if (isBridgeProvider(value) && !bridgeProviders[value].disabled) return value;
  } catch {
    // ignore storage access failures (SSR / privacy mode)
  }
  return null;
}

export function loadStoredRouteId(environment: BridgeEnvironment = "testnet") {
  try {
    const id = window.localStorage.getItem(`${routeStorageKey}.${environment}.id`) ??
      (environment === "testnet" ? window.localStorage.getItem(`${routeStorageKey}.id`) : null);
    // Older preferences included the revision; token and direction identities are stable.
    const stableId = id?.replace(/^(testnet|mainnet)-[a-f0-9]{40}:/, "$1:");
    return routesForEnvironment(environment).find(route => route.id === stableId);
  } catch {
    return undefined;
  }
}

export function saveStoredRoute(provider: BridgeProvider, routeId?: string, environment: BridgeEnvironment = "testnet") {
  try {
    window.localStorage.setItem(`${routeStorageKey}.${environment}`, provider);
    if (routeId) window.localStorage.setItem(`${routeStorageKey}.${environment}.id`, routeId);
  } catch {
    // ignore storage write failures
  }
}

// Persist the Send/Receive tab so a refresh keeps the current direction instead
// of snapping back to Receive every time.
const modeStorageKey = "miden.bridge.ui.mode";

export function loadStoredMode(environment: BridgeEnvironment = "testnet"): FlowMode | null {
  try {
    const value = window.localStorage.getItem(`${modeStorageKey}.${environment}`) ?? (environment === "testnet" ? window.localStorage.getItem(modeStorageKey) : null);
    return isFlowMode(value) ? value : null;
  } catch {
    // ignore storage access failures (SSR / privacy mode)
  }
  return null;
}

export function saveStoredMode(mode: FlowMode, environment: BridgeEnvironment = "testnet") {
  try {
    window.localStorage.setItem(`${modeStorageKey}.${environment}`, mode);
  } catch {
    // ignore storage write failures
  }
}

function normalizeActivity(activity: Activity): Activity {
  // Address-only matching could pin a previous exit and permanently mark a new
  // withdrawal complete. Discard those unbound observations before the terminal
  // state merger runs; the monitor recovers this transaction's output commitments.
  if (activity.provider === "agglayer" && activity.mode === "send" &&
      activity.agglayerExitHashes === undefined && activity.status !== "failed") {
    activity = {
      ...activity,
      status: activity.status === "signature" ? "signature" : "source_finality",
      eta: "Verifying withdrawal",
      depositCount: undefined,
      destinationTxHash: undefined,
      claimTxHash: undefined,
      destinationTxAt: undefined,
      readyForClaim: undefined,
    };
  }
  return normalizeActivityState(activity);
}

function normalizeActivities(parsed: unknown): Activity[] {
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((activity: Activity) => {
    if (!activity || !isBridgeProvider(activity.provider) || !isFlowMode(activity.mode)) return [];
    const route = receiptRouteSchema.safeParse(activity.routeSnapshot);
    if (!route.success) return [];
    const routeSnapshot = route.data;
    if (activity.provider === "near") {
      const operation = nearOperationSchema.safeParse(activity.near);
      if (!operation.success) return [];
      const near = operation.data;
      // Earlier portals counted a reported EVM hash as a mined deposit.
      if (isEvmAsset(routeSnapshot.source) && awaitsNearDeposit(near.status) && near.submission === "confirmed" &&
          (typeof activity.sourceTxHash !== "string" || near.confirmedEvmTxHash?.toLowerCase() !== activity.sourceTxHash.toLowerCase())) {
        near.submission = activity.sourceTxHash ? "accepted" : "attempted";
      }
      activity = { ...activity, near };
      // Older receipts reused receivedAmount for the quote before settlement.
      // A differing final amount is known to be actual. Recheck ambiguous ones.
      if (!operation.data.statusUpdatedAt && activity.receivedAmount !== undefined &&
          (operation.data.status !== "SUCCESS" || activity.receivedAmount === nearExpectedAmount(operation.data, routeSnapshot.destination.decimals))) {
        activity = { ...activity, receivedAmount: undefined };
      }
      if (activity.mode === "receive") {
        const recipient = nearMidenAddress.safeParse(operation.data.quote.quoteRequest.recipient);
        if (!recipient.success) return [];
        activity = { ...activity, midenAccount: recipient.data, midenAccountHex: normalizeMidenAccountHex(recipient.data) };
      }
    }
    if (routeSnapshot.provider !== activity.provider || routeSnapshot.mode !== activity.mode ||
        activity.asset !== routeSnapshot.source.symbol || typeof activity.updatedAt !== "number" ||
        [activity.id, activity.amount, activity.summary, activity.eta, activity.txHash].some(value => typeof value !== "string")) return [];
    const network = routeEnvironment(routeSnapshot);
    return [normalizeActivity({ ...activity, environment: network, routeSnapshot })];
  });
}

function readRows(key: string) {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return normalizeActivities(parsed);
  } catch { /* An unreadable generation cannot rule out an earlier funding claim. */ }
}

export function saveActivities(activities: Activity[]) {
  window.localStorage.setItem(activityStorageKey, JSON.stringify(activities));
}

function readHistory() {
  const currentRows = readRows(activityStorageKey);
  const legacyRows = readRows(legacyActivityStorageKey);
  const saved = new Map(currentRows?.map(activity => [activity.id, activity]));
  let needsMigration = false;
  const history = new Map(saved);
  for (const legacy of legacyRows ?? []) {
    const current = saved.get(legacy.id);
    if (!current) {
      history.set(legacy.id, legacy);
      // Protect earlier NEAR receipts as soon as the current portal opens.
      if (legacy.provider === "near") {
        saved.set(legacy.id, legacy);
        needsMigration = true;
      }
    } else if (legacy.updatedAt > current.updatedAt && legacy.provider === current.provider && legacy.mode === current.mode &&
        legacy.routeId === current.routeId && legacy.near?.quote.signature === current.near?.quote.signature) {
      const merged = applyActivityPatch(current, legacy, legacy.updatedAt);
      history.set(legacy.id, merged);
      saved.set(legacy.id, merged);
      needsMigration = true;
    }
  }
  return {
    activities: [...history.values()],
    complete: currentRows !== undefined && legacyRows !== undefined,
    needsMigration,
    write(changes: Activity[]) {
      if (!currentRows) throw new Error("Cannot update unreadable receipt storage.");
      // Untouched legacy history stays in v2. Old tabs can keep writing there
      // without replacing a current funding claim.
      for (const activity of changes) saved.set(activity.id, activity);
      saveActivities([...saved.values()]);
    },
  };
}

/** Validate and migrate untrusted historical receipts at the storage boundary. */
export function loadStoredActivities(environment?: BridgeEnvironment): Activity[] {
  return readHistory().activities.filter(activity => !environment || activity.environment === environment)
    .sort((a, b) => activityStartedAt(b) - activityStartedAt(a));
}

export const activityPersistence: ActivityPersistence = {
  read: readHistory,
  withWriteLock: commit => globalThis.navigator?.locks
    ? navigator.locks.request(activityStorageKey, commit).catch(() => false)
    : commit(),
};
