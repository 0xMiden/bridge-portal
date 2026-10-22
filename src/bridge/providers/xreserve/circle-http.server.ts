import { ZodError } from "zod";
import { CircleApiError } from "./circle-error";

function isTimeout(cause: unknown): boolean {
  return cause instanceof Error && ["TimeoutError", "AbortError"].includes(cause.name);
}

function transportFailure(cause: unknown): CircleApiError {
  const reason = isTimeout(cause) ? "upstream_timeout" : "upstream_network";
  return new CircleApiError(reason, "Circle is unavailable. Please retry.", { cause });
}

async function sendCircleRequest(url: string, body: unknown): Promise<Response> {
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify(body),
    });
  } catch (cause) {
    throw transportFailure(cause);
  }
}

/** Share transport behavior without coupling the different quote response schemas. */
export async function postCircleJson(url: string, body: unknown): Promise<unknown> {
  const response = await sendCircleRequest(url, body);
  if (!response.ok) {
    throw new CircleApiError("upstream_http", "Circle is unavailable. Please retry.", { status: response.status });
  }
  try {
    return await response.json();
  } catch (cause) {
    if (cause instanceof SyntaxError) {
      throw new CircleApiError("invalid_response", "Circle returned invalid JSON. Please retry.", { cause });
    }
    throw transportFailure(cause);
  }
}

function diagnosticCause(cause: unknown) {
  if (cause instanceof ZodError) {
    return { kind: "schema", issues: cause.issues.slice(0, 10).map(issue => ({ code: issue.code, path: issue.path })) };
  }
  if (cause instanceof SyntaxError) return { kind: "json" };
  if (cause instanceof TypeError) return { kind: "network" };
  if (isTimeout(cause)) return { kind: "timeout" };
  return undefined;
}

/** Log only allowlisted metadata, never payloads, URLs, wallet addresses, or raw errors. */
export function reportCircleFailure(operation: "quote" | "validation" | "withdrawal", error: unknown): void {
  const failure = error instanceof CircleApiError ? error : undefined;
  console.error("[circle] request failed", {
    operation,
    reason: failure?.reason ?? "unexpected",
    status: failure?.status,
    cause: diagnosticCause(failure?.cause),
  });
}
