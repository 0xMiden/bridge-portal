import type { Activity, BridgeActivity } from "./core/models";
import { directionFor } from "./providers/registry";
import { activityStartedAt, stampLegTimes } from "./core/rules";
import { shortAddress } from "../wallets/identity";
import { mergeNearActivityPatch } from "./providers/near/operation";

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
export function applyActivityPatch(activity: Activity, patch: Partial<Activity>, observedAt = Date.now()): Activity {
  if (patch.near) patch = mergeNearActivityPatch(activity, patch);
  const previous = activityState(activity);
  const observed = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  let next = normalizeActivityState({ ...activity, ...observed, updatedAt: observedAt });
  const settled = previous.status === "complete" || previous.status === "failed" || previous.status === "refunded";
  const incoming = activityState(next);
  const stale = incoming.status !== "failed" && incoming.status !== "complete" && incoming.order < previous.order;
  if (settled || stale) {
    // Preserve the current phase while accepting late identifiers and other metadata.
    const phase = Object.fromEntries(directionFor(activity).phaseFields.map((key) => [key, activity[key]]));
    next = { ...next, ...phase, status: previous.status, eta: activity.eta };
  }
  return stampLegTimes(next, observedAt);
}

export interface ActivityPersistence {
  read(): { activities: Activity[]; complete: boolean; needsMigration: boolean; write(changes: Activity[]): void };
  withWriteLock(commit: () => boolean): boolean | Promise<boolean>;
}

export type ActivityReceipt = {
  activity: Activity;
  /** Only changed fields are retried; absence means this receipt is saved. */
  unsavedChanges?: Partial<Activity>;
};

type ActivitySnapshot = {
  ready: boolean;
  receipts: readonly ActivityReceipt[];
};

// Optional fields are omitted on disk. Compare receipt data the same way after a reload.
function sameReceiptValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  return Object.keys(left).every(key => sameReceiptValue(left[key], right[key])) &&
    Object.keys(right).every(key => Object.hasOwn(left, key) || right[key] === undefined);
}

/** App-scoped activity state shared by submission, monitoring and rendering. */
export class ActivityStore {
  private snapshot: ActivitySnapshot = { ready: false, receipts: [] };
  private readonly listeners = new Set<() => void>();

  constructor(private readonly persistence: ActivityPersistence) {}

  getSnapshot = () => this.snapshot;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  get(id: string) {
    return this.snapshot.receipts.find(receipt => receipt.activity.id === id);
  }

  record(activity: Activity): Activity {
    return this.update(normalizeActivityState({
      ...activity,
      ...(activity.sourceTxHash ? { txHash: shortAddress(activity.sourceTxHash) } : {}),
    }));
  }

  patch(id: string, patch: Partial<Activity>): Activity | undefined {
    const receipt = this.get(id);
    if (!receipt) return;
    return this.update(applyActivityPatch(receipt.activity, {
      ...patch,
      ...(patch.sourceTxHash ? { txHash: shortAddress(patch.sourceTxHash) } : {}),
    }));
  }

  /** Restore history and replay only unsaved changes onto the latest durable rows. */
  sync = (): boolean | Promise<boolean> => {
    // Read inside the lock. A queued writer must merge against the previous
    // writer's committed history, including transfers from other providers.
    return this.persistence.withWriteLock(() => this.reconcile());
  };

  private reconcile(): boolean {
    let receipts = this.snapshot.receipts;
    let saved = true;
    try {
      const history = this.persistence.read();
      saved = history.complete;
      const stored = new Map(history.activities.map(activity => [activity.id, { activity }]));
      const pending: ActivityReceipt[] = [];
      for (const receipt of receipts) {
        if (!receipt.unsavedChanges) {
          if (!history.complete && !stored.has(receipt.activity.id)) stored.set(receipt.activity.id, receipt);
          continue;
        }
        const remote = stored.get(receipt.activity.id);
        stored.delete(receipt.activity.id);
        pending.push({
          ...receipt,
          activity: remote ? applyActivityPatch(remote.activity, receipt.unsavedChanges) : receipt.activity,
        });
      }
      // Late observations and storage retries must not make old transfers look new.
      receipts = [...pending, ...stored.values()].sort((a, b) =>
        activityStartedAt(b.activity) - activityStartedAt(a.activity),
      );
      if (pending.length || history.needsMigration) {
        history.write(pending.map(receipt => receipt.activity));
        receipts = receipts.map(({ activity }) => ({ activity }));
      }
    } catch {
      // Failed reads leave durable history untouched. Failed writes retain the
      // merged receipts and their changes for the next retry.
      saved = false;
    }
    this.publish({ ready: true, receipts });
    return saved;
  }

  private update(activity: Activity): Activity {
    const current = this.get(activity.id);
    // Capture effective changes after the domain merger rejects stale phases.
    const changed = Object.fromEntries(Object.entries(activity).filter(([key, value]) =>
      key !== "updatedAt" && value !== undefined && !sameReceiptValue(value, current?.activity[key as keyof Activity]),
    ));
    if (current && !Object.keys(changed).length) {
      if (current.unsavedChanges) this.sync();
      return current.activity;
    }
    const receipt = { activity, unsavedChanges: { ...current?.unsavedChanges, ...changed, updatedAt: activity.updatedAt } };
    const receipts = current
      ? this.snapshot.receipts.map(item => item.activity.id === activity.id ? receipt : item)
      : [receipt, ...this.snapshot.receipts];
    // Acceptance and progress are available even before the first storage read.
    this.publish({ ready: true, receipts });
    this.sync();
    return this.get(activity.id)!.activity;
  }

  private publish(snapshot: ActivitySnapshot) {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
}
