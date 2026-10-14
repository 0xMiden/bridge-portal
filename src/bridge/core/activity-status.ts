/** Transfer progress shared by protocol adapters and activity tracking. */
export type ActivityStatus =
  | "signature"
  | "source_finality"
  | "message_observed"
  | "claim_available"
  | "claim_submitted"
  | "failed"
  | "complete";
