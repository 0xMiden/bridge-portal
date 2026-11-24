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
import { shortAddress } from "../../wallets/identity";

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

function normalizeStoredActivity(activity: Activity): Activity | undefined {
  if (!activity || !isBridgeProvider(activity.provider) || !isFlowMode(activity.mode)) return;
  const route = receiptRouteSchema.safeParse(activity.routeSnapshot);
  if (!route.success) return;
  const routeSnapshot = route.data;
  if (activity.provider === "near") {
    const operation = nearOperationSchema.safeParse(activity.near);
    if (!operation.success) return;
    const near = operation.data;
    // Earlier monitors could save 1Click's Miden note ID as the wallet transaction hash.
    if (activity.mode === "send" && activity.midenNoteId && activity.sourceTxHash === activity.midenNoteId) {
      const walletTx = activity.midenTxId !== activity.midenNoteId ? activity.midenTxId : undefined;
      activity = { ...activity, sourceTxHash: walletTx, txHash: walletTx ? shortAddress(walletTx) : "0xpending" };
    }
    if (isEvmAsset(routeSnapshot.source) && (typeof activity.sourceTxHash !== "string" ||
        near.finalizedEvmTxHash?.toLowerCase() !== activity.sourceTxHash.toLowerCase())) {
      // Older receipts could stop tracking on an unfinalized cancellation or revert.
      if (near.status === "FAILED" && activity.failureLeg === "source") {
        near.status = "KNOWN_DEPOSIT_TX";
        activity = { ...activity, failureLeg: undefined, sourceTxHash: activity.sourceOriginalTxHash ?? activity.sourceTxHash };
      }
      if (awaitsNearDeposit(near.status) && near.submission === "confirmed") near.submission = activity.sourceTxHash ? "accepted" : "attempted";
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
      if (!recipient.success) return;
      activity = { ...activity, midenAccount: recipient.data, midenAccountHex: normalizeMidenAccountHex(recipient.data) };
    }
  }
  if (routeSnapshot.provider !== activity.provider || routeSnapshot.mode !== activity.mode ||
      activity.asset !== routeSnapshot.source.symbol || typeof activity.updatedAt !== "number" ||
      [activity.id, activity.amount, activity.summary, activity.eta, activity.txHash].some(value => typeof value !== "string")) return;
  const network = routeEnvironment(routeSnapshot);
  return normalizeActivity({ ...activity, environment: network, routeSnapshot });
}

type UnreadableClaim = { id?: string; raw: unknown };

function readRows(key: string) {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    if (!Array.isArray(parsed)) return;
    const activities: Activity[] = [];
    const claims: UnreadableClaim[] = [];
    for (const row of parsed) {
      let activity: Activity | undefined;
      try { activity = normalizeStoredActivity(row); }
      catch { /* Isolate malformed data so other receipts can still be restored. */ }
      if (activity) activities.push(activity);
      else if (row?.provider === "near" || row?.near || (typeof row?.id === "string" && row.id.startsWith("act-near-"))) {
        // Even an unrenderable receipt can record a wallet payment for this quote.
        const id = typeof row.id === "string" && /^act-near-[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(row.id) ? row.id : undefined;
        claims.push({ id, raw: row });
      }
    }
    return { activities, claims };
  } catch { /* An unreadable generation cannot rule out an earlier funding claim. */ }
}

export function saveActivities(activities: Activity[], preserved: unknown[] = []) {
  window.localStorage.setItem(activityStorageKey, JSON.stringify([...activities, ...preserved]));
}

function readHistory() {
  const currentRows = readRows(activityStorageKey);
  const legacyRows = readRows(legacyActivityStorageKey);
  const saved = new Map(currentRows?.activities.map(activity => [activity.id, activity]));
  let needsMigration = false;
  const history = new Map(saved);
  const claims = [...(currentRows?.claims ?? [])];
  // Protect unreadable legacy claims from the next write made by an older portal.
  const preserved = new Set(claims.map(claim => JSON.stringify(claim.raw)));
  for (const claim of legacyRows?.claims ?? []) {
    const raw = JSON.stringify(claim.raw);
    if (!preserved.has(raw)) {
      claims.push(claim);
      preserved.add(raw);
      needsMigration = true;
    }
  }
  for (const legacy of legacyRows?.activities ?? []) {
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
    complete: Boolean(currentRows && legacyRows && !claims.length),
    canFund: (id: string) => Boolean(currentRows && legacyRows && claims.every(claim => claim.id && claim.id !== id)),
    needsMigration,
    write(changes: Activity[]) {
      if (!currentRows) throw new Error("Cannot update unreadable receipt storage.");
      // Untouched legacy history stays in v2. Old tabs can keep writing there
      // without replacing a current funding claim.
      for (const activity of changes) saved.set(activity.id, activity);
      saveActivities([...saved.values()], claims.map(claim => claim.raw));
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
