export type CircleFailureReason =
  | "invalid_response"
  | "binding_mismatch"
  | "unsupported_nonce"
  | "invalid_services"
  | "inconsistent_validation"
  | "rejected_quote"
  | "upstream_http"
  | "upstream_network"
  | "upstream_timeout";

/** A stable diagnostic code; raw provider data belongs only in the error cause. */
export class CircleApiError extends Error {
  readonly status?: number;

  constructor(readonly reason: CircleFailureReason, message: string, options?: ErrorOptions & { status?: number }) {
    super(message, options);
    this.name = "CircleApiError";
    this.status = options?.status;
  }
}
