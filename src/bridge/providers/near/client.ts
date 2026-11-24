import type { QuoteRequest, TransferQuote } from "../../core/quote";
import { nearInput, nearQuoteResult, verifyNearQuote } from "./quote";
import type { NearOperation, NearQuoteResponse } from "./schema";

class NearHttpError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function nearPost(path: "quote" | "prepare" | "status" | "deposit/submit", body: unknown, signal?: AbortSignal): Promise<unknown> {
  const timeout = AbortSignal.timeout(path === "quote" || path === "prepare" ? 40_000 : 20_000);
  const response = await fetch(`/api/near/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new NearHttpError(`${payload?.error ?? "NEAR is unavailable. Please retry."}${payload?.correlationId ? ` Reference: ${payload.correlationId}` : ""}`, response.status);
  }
  return response.json();
}

export async function notifyNearDeposit(body: { routeId: string; quote: NearQuoteResponse; txHash: string }, retryAt: number | null,
  signal?: AbortSignal): Promise<Pick<NearOperation, "notification" | "notificationRetryAt">> {
  try {
    await nearPost("deposit/submit", body, signal);
    return { notification: "sent", notificationRetryAt: null };
  } catch (error) {
    signal?.throwIfAborted();
    const rejected = error instanceof NearHttpError && (error.status === 400 || error.status === 422);
    return { notification: "pending", notificationRetryAt: rejected ? null : retryAt };
  }
}

export async function fetchNearQuote(input: QuoteRequest, dry: boolean, signal: AbortSignal) {
  const bound = nearInput(input);
  const response = verifyNearQuote(await nearPost(dry ? "quote" : "prepare", bound, signal), bound, dry);
  return nearQuoteResult(response, input.route.id);
}

export async function prepareNearTransfer(input: QuoteRequest, signal: AbortSignal): Promise<TransferQuote> {
  const result = await fetchNearQuote(input, false, signal);
  return { ...result, request: { routeId: input.route.id, recovery: input.route.recovery, amount: input.amount,
    midenAccount: input.midenAccount, externalAddress: input.externalAddress } };
}
