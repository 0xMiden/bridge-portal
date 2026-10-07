/** Transfer progress shared by protocol adapters and activity tracking. */
export type ActivityStatus =
  | "signature"
  | "source_finality"
  | "message_observed"
  | "claim_available"
  | "claim_submitted"
  | "failed"
  | "complete";

/** Ordered lifecycle milestones; failures are handled separately. */
export const activitySteps = [
  "signature",
  "source_finality",
  "message_observed",
  "claim_available",
  "claim_submitted",
  "complete",
] as const satisfies readonly ActivityStatus[];
