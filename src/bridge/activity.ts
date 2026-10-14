import type { Activity, BridgeActivity } from "./core/models";
import { directionFor } from "./providers/registry";
import { stampLegTimes } from "./core/rules";

/** One interpretation for storage, polling, history and receipts. */
export function activityState(activity: BridgeActivity) {
  const direction = directionFor(activity);
  const phase = direction.resolvePhase(activity);
  const definition = direction.phases[phase];
  if (!definition) throw new Error(`Unknown ${activity.provider}/${activity.mode} phase: ${phase}`);
  return { phase, ...definition };
}

export function normalizeActivityState<T extends BridgeActivity>(activity: T): T {
  const state = activityState(activity);
  return { ...activity, status: state.status };
}

/** Merge observations without allowing stale polls to regress a terminal transfer. */
export function applyActivityPatch(activity: Activity, patch: Partial<Activity>): Activity {
  const previous = activityState(activity);
  const observed = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  let next = normalizeActivityState({ ...activity, ...observed, updatedAt: Date.now() });
  const settled = previous.status === "complete" || previous.status === "failed";
  const incoming = activityState(next);
  const stale = incoming.status !== "failed" && incoming.status !== "complete" && incoming.order < previous.order;
  if (settled || stale) {
    // Preserve the current phase while accepting late identifiers and other metadata.
    const phase = Object.fromEntries(directionFor(activity).phaseFields.map((key) => [key, activity[key]]));
    next = { ...next, ...phase, status: previous.status, eta: activity.eta };
  }
  return stampLegTimes(next);
}
