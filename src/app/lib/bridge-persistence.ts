import { bridgeProviders } from "../../bridge/providers/registry";
import { applyActivityPatch, normalizeActivityState } from "../../bridge/activity";
import { shortAddress } from "../../wallets/identity";
import { findBridgeRoute } from "../../bridge/core/routes";
import { isFlowMode, type BridgeProvider, type FlowMode } from "../../bridge/core/models";
import { isBridgeProvider } from "../../bridge/providers/registry";
import { type Activity } from "./bridge-presentation";

export const activityStorageKey = "miden.bridge.ui.activities";

// Persist the last-selected route so a refresh returns to it (e.g. Agglayer)
// instead of snapping back to the default every time.
const routeStorageKey = "miden.bridge.ui.route";

export function loadStoredRoute(): BridgeProvider | null {
  try {
    const value = window.localStorage.getItem(routeStorageKey);
    if (isBridgeProvider(value) && !bridgeProviders[value].disabled) return value;
  } catch {
    // ignore storage access failures (SSR / privacy mode)
  }
  return null;
}

export function loadStoredRouteId() {
  try { return findBridgeRoute(window.localStorage.getItem(`${routeStorageKey}.id`) ?? ""); } catch { return undefined; }
}

export function saveStoredRoute(provider: BridgeProvider, routeId?: string) {
  try {
    window.localStorage.setItem(routeStorageKey, provider);
    if (routeId) window.localStorage.setItem(`${routeStorageKey}.id`, routeId);
  } catch {
    // ignore storage write failures
  }
}

// Persist the Send/Receive tab so a refresh keeps the current direction instead
// of snapping back to Receive every time.
const modeStorageKey = "miden.bridge.ui.mode";

export function loadStoredMode(): FlowMode | null {
  try {
    const value = window.localStorage.getItem(modeStorageKey);
    return isFlowMode(value) ? value : null;
  } catch {
    // ignore storage access failures (SSR / privacy mode)
  }
  return null;
}

export function saveStoredMode(mode: FlowMode) {
  try {
    window.localStorage.setItem(modeStorageKey, mode);
  } catch {
    // ignore storage write failures
  }
}

function normalizeActivity(activity: Activity): Activity {
  // Agglayer receipts predating midenAccountHex stored its encoded bridge address.
  const encodedAccount = /^0x0{8}([0-9a-fA-F]{30})00$/.exec(activity.bridgeDestinationAddress ?? "");
  const midenAccountHex = activity.midenAccountHex ??
    (encodedAccount ? `0x${encodedAccount[1].toLowerCase()}` : undefined);
  // Before failureLeg was persisted, the monitor stored this information in eta.
  const failureLeg = activity.failureLeg ?? (activity.status === "failed"
    ? (/destination/i.test(activity.eta) ? "destination" : "source")
    : undefined);
  // Migrate pre-timestamp rows: `updatedAt` used to be a display string ("Just
  // now"). Coerce any non-number to 0, then backfill from the id — createActivity
  // stamps `act-<base36 creation-ms>`, so old rows can still show a real time
  // instead of "—".
  let updatedAt =
    typeof activity.updatedAt === "number" ? activity.updatedAt : 0;
  if (!updatedAt) {
    const match = /^act-([0-9a-z]+)$/.exec(activity.id);
    const fromId = match ? parseInt(match[1], 36) : NaN;
    // Guard against non-timestamp ids: only accept a plausible epoch-ms value.
    if (Number.isFinite(fromId) && fromId > 1_600_000_000_000) updatedAt = fromId;
  }
  // Older rows stored the SDK's decimal amount followed by the token symbol.
  // Normalize that legacy representation only at the storage boundary.
  const suffix = ` ${activity.asset}`;
  const receivedAmount = activity.receivedAmount?.endsWith(suffix)
    ? activity.receivedAmount.slice(0, -suffix.length)
    : activity.receivedAmount;
  return normalizeActivityState({ ...activity, midenAccountHex, failureLeg, updatedAt, receivedAmount });
}

export function loadStoredActivities(): Activity[] {
  const raw = window.localStorage.getItem(activityStorageKey);
  if (!raw) return [];
  const parsed = JSON.parse(raw) as Activity[];
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((activity) => activity && isBridgeProvider(activity.provider) && isFlowMode(activity.mode))
    .map(normalizeActivity);
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
