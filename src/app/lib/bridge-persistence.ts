import { receiptRouteSchema } from "../../bridge/core/receipt-route";
import { bridgeProviders } from "../../bridge/providers/registry";
import { normalizeActivityState, type ActivityPersistence } from "../../bridge/activity";
import { routeEnvironment, routesForEnvironment } from "../../bridge/core/routes";
import { isFlowMode, type BridgeProvider, type FlowMode } from "../../bridge/core/models";
import { isBridgeProvider } from "../../bridge/providers/registry";
import { type Activity } from "./bridge-presentation";

import type { BridgeEnvironment } from "../../config/environment";
import { helperActivitySchema } from "../../bridge/providers/xreserve/helper-types";
import { arcRecipient, parseArcAmount } from "../../bridge/providers/xreserve/deposit-terms";

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

function normalizeActivities(parsed: unknown): Activity[] {
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((activity: Activity) => {
    if (!activity || !isBridgeProvider(activity.provider) || !isFlowMode(activity.mode)) return [];
    const route = receiptRouteSchema.safeParse(activity.routeSnapshot);
    if (!route.success) return [];
    const routeSnapshot = route.data;
    if (routeSnapshot.transport === "cctp-helper") {
      const helper = helperActivitySchema.safeParse(activity.cctpHelper);
      if (!helper.success || !routeSnapshot.helperDeployment) return [];
      try {
        const auth = helper.data.authorization;
        if (helper.data.stage === "source_failed" && activity.sourceTxHash !== helper.data.signature) return [];
        if (JSON.stringify(auth.deployment) !== JSON.stringify(routeSnapshot.helperDeployment) || auth.deploymentId !== routeSnapshot.helperDeployment.deploymentId ||
            auth.sourceAccount !== activity.solanaAddress || auth.grossAmount !== parseArcAmount(activity.amount).toString() ||
            !activity.midenAccount || auth.midenRecipient !== arcRecipient(activity.midenAccount)) return [];
      } catch { return []; }
      activity = { ...activity, cctpHelper: helper.data };
    } else if (activity.cctpHelper) return [];
    if (routeSnapshot.provider !== activity.provider || routeSnapshot.mode !== activity.mode ||
        activity.asset !== routeSnapshot.source.symbol || typeof activity.updatedAt !== "number" ||
        [activity.id, activity.amount, activity.summary, activity.eta, activity.txHash].some(value => typeof value !== "string")) return [];
    const network = routeEnvironment(routeSnapshot);
    return [normalizeActivity({ ...activity, environment: network, routeSnapshot })];
  });
}

/** Validate and migrate untrusted historical receipts at the storage boundary. */
export function loadStoredActivities(environment?: BridgeEnvironment): Activity[] {
  const raw = window.localStorage.getItem(activityStorageKey);
  const activities = raw ? normalizeActivities(JSON.parse(raw)) : [];
  return activities.filter(activity => !environment || activity.environment === environment);
}

/** Submission cannot treat a corrupt manual row as evidence that no previous burn exists. */
export function loadManualSubmissionActivities(): Activity[] {
  const raw = window.localStorage.getItem(activityStorageKey);
  const parsed: unknown = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(parsed)) throw new Error("Saved source history is invalid. Recover it before starting another burn.");
  const ids = new Set<string>();
  for (const value of parsed) {
    if (!value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>, route = row.routeSnapshot;
    if (!("cctpHelper" in row) && !(route && typeof route === "object" && "transport" in route && route.transport === "cctp-helper")) continue;
    const normalized = normalizeActivities([value]);
    if (normalized.length !== 1 || ids.has(normalized[0].id))
      throw new Error("Saved manual source history is invalid. Recover it before starting another burn.");
    ids.add(normalized[0].id);
  }
  return normalizeActivities(parsed);
}

export function saveActivities(activities: Activity[]) {
  // Ordinary activity writes must not erase a malformed manual row that the
  // display reader omitted. Refuse that write and retain the original evidence.
  const durable = loadManualSubmissionActivities();
  const retained = durable.filter(activity => activity.cctpHelper && !activities.some(next => next.id === activity.id));
  window.localStorage.setItem(activityStorageKey, JSON.stringify([...activities, ...retained]));
}

export const activityPersistence: ActivityPersistence = {
  read: loadStoredActivities,
  write: saveActivities,
};
