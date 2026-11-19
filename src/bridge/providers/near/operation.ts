import type { NearOperation, NearStatus } from "./schema";
import type { Activity, BridgeActivity } from "../../core/models";
import { formatUnits } from "viem";

const submissionOrder = { prepared: 0, awaiting_deposit: 1, attempted: 1, not_sent: 2, declined: 2, accepted: 3, confirmed: 4 };
const statusOrder = { PENDING_DEPOSIT: 0, KNOWN_DEPOSIT_TX: 1, INCOMPLETE_DEPOSIT: 2, PROCESSING: 3, SUCCESS: 4, REFUNDED: 4, FAILED: 4 };

export function awaitsNearDeposit(status: NearStatus) {
  return status === "PENDING_DEPOSIT" || status === "KNOWN_DEPOSIT_TX";
}

export function missingNearSettlement(activity: BridgeActivity) {
  return activity.near?.status === "SUCCESS" && (activity.receivedAmount === undefined || !activity.destinationTxHash);
}

export function nearExpectedAmount(operation: NearOperation, decimals: number) {
  return formatUnits(BigInt(operation.quote.quote.amountOut), decimals);
}

/** Wallet callbacks and polls can finish out of order; neither may erase accepted evidence. */
export function mergeNearActivityPatch(activity: Activity, patch: Partial<Activity>): Partial<Activity> {
  const current = activity.near;
  const incoming = patch.near;
  if (!current || !incoming) return patch;
  const order = statusOrder[current.status];
  const stale = order > statusOrder[incoming.status] || (order === 4 && current.status !== incoming.status) ||
    (current.status === incoming.status && current.statusUpdatedAt &&
      (!incoming.statusUpdatedAt || Date.parse(incoming.statusUpdatedAt) < Date.parse(current.statusUpdatedAt)));
  const observation = stale ? current : incoming;
  const near: NearOperation = { ...current, ...observation, quote: current.quote,
    submission: submissionOrder[current.submission] > submissionOrder[incoming.submission] ? current.submission : incoming.submission,
    notification: current.notification === "sent" ? "sent" : incoming.notification,
    confirmedEvmTxHash: observation.confirmedEvmTxHash ?? current.confirmedEvmTxHash,
    originTxHashes: observation.originTxHashes?.length ? observation.originTxHashes : current.originTxHashes,
    destinationTxHashes: observation.destinationTxHashes?.length ? observation.destinationTxHashes : current.destinationTxHashes,
    refundedAmount: observation.refundedAmount ?? current.refundedAmount,
    refundReason: observation.refundReason ?? current.refundReason,
  };
  const replacement = patch.sourceTxHash && activity.sourceTxHash && patch.sourceTxHash.toLowerCase() !== activity.sourceTxHash.toLowerCase();
  if (stale) {
    // A late wallet callback may identify the original of an already settled replacement.
    return { ...patch, near,
      sourceTxHash: activity.sourceTxHash ?? patch.sourceTxHash,
      txHash: activity.sourceTxHash ? activity.txHash : patch.txHash,
      sourceOriginalTxHash: activity.sourceOriginalTxHash ?? patch.sourceOriginalTxHash ?? (replacement && incoming.submission === "accepted" ? patch.sourceTxHash : undefined),
      destinationTxHash: activity.destinationTxHash ?? patch.destinationTxHash,
      midenTxId: activity.midenTxId ?? patch.midenTxId,
      receivedAmount: activity.receivedAmount ?? (near.status === "SUCCESS" ? patch.receivedAmount : undefined),
    };
  }
  return { ...patch, near, sourceOriginalTxHash: activity.sourceOriginalTxHash ?? patch.sourceOriginalTxHash ?? (replacement ? activity.sourceTxHash : undefined) };
}
