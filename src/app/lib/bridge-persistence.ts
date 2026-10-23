import { receiptRouteSchema } from "../../bridge/core/receipt-route";
import { bridgeProviders } from "../../bridge/providers/registry";
import { applyActivityPatch, normalizeActivityState } from "../../bridge/activity";
import { shortAddress } from "../../wallets/identity";
import { routeEnvironment, routesForEnvironment } from "../../bridge/core/routes";
import { isFlowMode, type BridgeProvider, type FlowMode } from "../../bridge/core/models";
import { isBridgeProvider } from "../../bridge/providers/registry";
import { type Activity } from "./bridge-presentation";

import type { BridgeEnvironment } from "../../config/environment";

export const activityStorageKey = "miden.bridge.ui.activities.v2";

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

export function loadStoredActivities(environment?: BridgeEnvironment): Activity[] {
  const raw = window.localStorage.getItem(activityStorageKey);
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((activity: Activity) => {
    if (!activity || !isBridgeProvider(activity.provider) || !isFlowMode(activity.mode)) return [];
    const route = receiptRouteSchema.safeParse(activity.routeSnapshot);
    if (!route.success) return [];
    const routeSnapshot = route.data;
    if (routeSnapshot.provider !== activity.provider || routeSnapshot.mode !== activity.mode ||
        activity.asset !== routeSnapshot.source.symbol || typeof activity.updatedAt !== "number" ||
        [activity.id, activity.amount, activity.summary, activity.eta, activity.txHash].some(value => typeof value !== "string")) return [];
    const network = routeEnvironment(routeSnapshot);
    if (environment && network !== environment) return [];
    return [normalizeActivity({ ...activity, environment: network, routeSnapshot })];
  });
}

export function saveActivities(activities: Activity[]) {
  window.localStorage.setItem(activityStorageKey, JSON.stringify(activities));
}

/**
 * Merge a patch into one stored activity by id and persist. Used by the submit
 * flow to update an already-navigated-to activity as the (backgrounded)
 * execution progresses, so the detail page reflects it on its next re-read.
 */
export function patchStoredActivity(id: string, patch: Partial<Activity>) {
  try {
    const activities = loadStoredActivities();
    saveActivities(
      activities.map((item) =>
        item.id === id ? applyActivityPatch(item, { ...patch, ...(patch.sourceTxHash ? { txHash: shortAddress(patch.sourceTxHash) } : {}) }) : item,
      ),
    );
  } catch {
    // ignore transient storage errors
  }
}
