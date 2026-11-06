import type { NearOperation } from "./schema";

const submissionOrder = { prepared: 0, attempted: 1, accepted: 2, confirmed: 3 };
const statusOrder = { PENDING_DEPOSIT: 0, KNOWN_DEPOSIT_TX: 1, INCOMPLETE_DEPOSIT: 2, PROCESSING: 3, SUCCESS: 4, REFUNDED: 4, FAILED: 4 };

/** Wallet callbacks and polls can finish out of order; neither may erase accepted evidence. */
export function mergeNearOperation(current: NearOperation, incoming: NearOperation): NearOperation {
  return { ...current, ...incoming, quote: current.quote,
    submission: submissionOrder[current.submission] > submissionOrder[incoming.submission] ? current.submission : incoming.submission,
    notification: current.notification === "sent" ? "sent" : incoming.notification,
    status: statusOrder[current.status] === 4 || statusOrder[current.status] > statusOrder[incoming.status] ? current.status : incoming.status,
  };
}
