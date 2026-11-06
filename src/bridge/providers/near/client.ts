import type { QuoteRequest, TransferQuote } from "../../core/quote";
import { nearInput, nearQuoteResult, verifyNearQuote } from "./quote";

export async function nearPost(path: "quote" | "prepare" | "status" | "deposit/submit", body: unknown, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(`/api/near/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store",
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`${payload.error ?? "NEAR is unavailable. Please retry."}${payload.correlationId ? ` Reference: ${payload.correlationId}` : ""}`);
  return payload;
}

export async function fetchNearQuote(input: QuoteRequest, dry: boolean, signal: AbortSignal) {
  const bound = nearInput(input);
  const response = verifyNearQuote(await nearPost(dry ? "quote" : "prepare", bound, signal), bound, dry);
  return nearQuoteResult(response, input.route.id);
}

export async function prepareNearTransfer(input: QuoteRequest, signal: AbortSignal): Promise<TransferQuote> {
  const result = await fetchNearQuote(input, false, signal);
  return { ...result, request: { routeId: input.route.id, recovery: input.route.recovery, amount: input.amount,
    midenAccount: input.midenAccount, evmAddress: input.evmAddress } };
}
