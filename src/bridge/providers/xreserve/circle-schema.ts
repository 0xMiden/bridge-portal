import { z } from "zod";
import { CircleApiError } from "./circle-error";

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
