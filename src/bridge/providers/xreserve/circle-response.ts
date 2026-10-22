import { z } from "zod";

type CircleFailureReason =
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

const apiErrorSchema = z.object({ error: z.string() });

/** Parse the boundary once, retaining schema diagnostics for the server reporter. */
export function parseCirclePayload<T>(schema: z.ZodType<T>, value: unknown, message: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new CircleApiError("invalid_response", message, { cause: parsed.error });
  return parsed.data;
}

export function circleApiError(value: unknown, fallback: string): Error {
  const parsed = apiErrorSchema.safeParse(value);
  return new Error(parsed.success ? parsed.data.error : fallback);
}
