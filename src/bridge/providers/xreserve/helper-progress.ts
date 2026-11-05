import { configKey } from "../../../config/bridge-config";
import type { HelperActivity } from "./helper-types";
import type { ArcCursor, ArcScan, HelperCompletion } from "./helper-completion-types";

const order: Record<HelperActivity["stage"], number> = { reviewed: 0, signing: 0, signed: 1, source_unknown: 2,
  needs_attention: 2, source_finalized: 3, ready: 4, attested: 4, arc_deposited: 5, reserve_attested: 6, delivered: 7, source_failed: 8 };

function sameAttempt(previous: HelperActivity, incoming: HelperActivity) {
  if (previous.attemptId !== incoming.attemptId || configKey(previous.authorization.deployment) !== configKey(incoming.authorization.deployment)) return false;
  const terms = ["sourceAccount", "grossAmount", "maxCctpFee", "midenRecipient"] as const;
  if (terms.some(field => previous.authorization[field] !== incoming.authorization[field])) return false;
  return !previous.signature || incoming.signature === previous.signature;
}
function contradictsProof(previous: HelperActivity, incoming: HelperActivity) {
  if (previous.bundle && incoming.bundle && previous.bundle.message !== incoming.bundle.message) return true;
  const evidence = [[previous.sourceEvidence, incoming.sourceEvidence], [previous.completion?.arc, incoming.completion?.arc],
    [previous.completion?.intent, incoming.completion?.intent]];
  return evidence.some(([saved, observed]) => saved && observed && configKey(saved) !== configKey(observed));
}
function sameCursor(cursor: ArcCursor, expected?: ArcCursor) {
  if (!expected) return false;
  return cursor.nextBlock === expected.nextBlock && configKey(cursor.checkpoint) === configKey(expected.checkpoint);
}
function mergeScan(previous?: ArcScan, incoming?: ArcScan) {
  if (!incoming) return previous;
  if (!previous) return incoming;
  // Only replace the exact invalid hint the server reset. A stale reset cannot
  // roll another tab's newer canonical page back; stale copies of the bad hint cannot return.
  if (sameCursor(previous, incoming.resetFrom)) return incoming;
  if (sameCursor(incoming, previous.resetFrom)) return previous;
  return BigInt(previous.nextBlock) > BigInt(incoming.nextBlock) ? previous : incoming;
}
function mergeCompletion(previous?: HelperCompletion, incoming?: HelperCompletion): HelperCompletion | undefined {
  if (!incoming) return previous;
  const scan = mergeScan(previous?.scan, incoming.scan);
  // Ambiguity is review-only evidence, not a later stage of a selected nonce.
  const review = previous?.needsAttention ? previous : incoming.needsAttention ? incoming : undefined;
  if (review) return { ...review, scan, arc: review.arc ?? previous?.arc, intent: undefined };
  const stage = previous && order[previous.stage] > order[incoming.stage] ? previous.stage : incoming.stage;
  return { ...previous, ...incoming, stage, scan, arc: incoming.arc ?? previous?.arc, intent: incoming.intent ?? previous?.intent };
}
function progressStage(previous: HelperActivity, incoming: HelperActivity) {
  if (previous.stage === "source_failed") return previous.stage;
  if (previous.sourceEvidence && incoming.stage === "source_failed") return previous.stage;
  return order[incoming.stage] < order[previous.stage] ? previous.stage : incoming.stage;
}
function earliestAnchor(previous: HelperActivity, incoming: HelperActivity) {
  const anchor = previous.authorization.arcAnchor, next = incoming.authorization.arcAnchor;
  if (!anchor) return next;
  if (!next || BigInt(anchor.block) <= BigInt(next.block)) return anchor;
  return next;
}

/** Concurrent polls merge into the newest durable proof, never into their stale copy. */
export function mergeHelperProgress(previous: HelperActivity, incoming: HelperActivity): { accepted: boolean; helper: HelperActivity } {
  if (!sameAttempt(previous, incoming) || contradictsProof(previous, incoming)) return { accepted: false, helper: previous };
  // Stale polls cannot clear review evidence or erase verified delivery.
  const clearsReview = previous.completion?.needsAttention && !incoming.completion?.needsAttention;
  const disputesDelivery = previous.stage === "delivered" && incoming.completion?.needsAttention;
  if (clearsReview || disputesDelivery) return { accepted: false, helper: previous };
  const completion = mergeCompletion(previous.completion, incoming.completion);
  const stage = completion?.needsAttention ? completion.stage : progressStage(previous, incoming);
  const sourceEvidence = incoming.sourceEvidence ?? previous.sourceEvidence, bundle = incoming.bundle ?? previous.bundle;
  const sourceResolved = stage === "source_failed" || !!sourceEvidence || !!bundle;
  return { accepted: true, helper: { ...previous, ...incoming, stage, sourceEvidence, bundle,
    completion, signature: incoming.signature ?? previous.signature,
    signedBytes: sourceResolved ? undefined : incoming.signedBytes ?? previous.signedBytes,
    authorization: { ...incoming.authorization, arcAnchor: earliestAnchor(previous, incoming) },
  } };
}
