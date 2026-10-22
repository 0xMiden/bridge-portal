import { formatUnits } from "viem";
import type { QuoteRequest, QuoteResult } from "../../core/quote";
import { normalizeMidenAccountHex } from "../agglayer/agglayer";
import { arcRecipient, parseArcAmount } from "./deposit-terms";
import {
  assertQuoteExpiry, cctpQuoteSchema, cctpRequestSchema,
  type CctpBurnIntent, type CctpQuote,
} from "./cctp-schema";
import { circleApiError, parseCirclePayload } from "./circle-schema";

export type { CctpQuote, CctpQuoteExpiry } from "./cctp-schema";
export type CctpQuoteRequest = CctpBurnIntent;

/** A quote authorizes one route, wallet pair, and amount. */
export function assertCctpQuoteMatches(candidate: CctpBurnIntent, request: CctpBurnIntent): void {
  if (candidate.network !== request.network || candidate.deploymentId !== request.deploymentId) {
    throw new Error("The transfer changed. Review the route and fee again.");
  }
  if (candidate.sender.toLowerCase() !== request.sender.toLowerCase() ||
      normalizeMidenAccountHex(candidate.recipient) !== normalizeMidenAccountHex(request.recipient)) {
    throw new Error("The transfer changed. Review the sender and recipient again.");
  }
  if (parseArcAmount(candidate.amount) !== parseArcAmount(request.amount)) {
    throw new Error("The transfer changed. Review the amount and fee again.");
  }
}

/** Parse the portal payload once, then check its transfer and issuance rules. */
export function parseCctpQuote(value: unknown, request: CctpQuoteRequest): CctpQuote {
  const quote = parseCirclePayload(cctpQuoteSchema, value, "Circle returned an invalid quote. Please retry.");
  assertCctpQuoteMatches(quote, request);
  assertQuoteExpiry(quote);
  return quote;
}

export async function fetchCctpQuote(input: CctpQuoteRequest, signal?: AbortSignal): Promise<CctpQuote> {
  const response = await fetch("/api/xreserve/quote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  const body: unknown = await response.json();
  if (!response.ok) throw circleApiError(body, "Circle quote unavailable. Please retry shortly.");
  return parseCctpQuote(body, input);
}

export async function quoteTransfer(input: QuoteRequest, signal: AbortSignal): Promise<QuoteResult> {
  const request = parseCirclePayload(cctpRequestSchema, {
    deploymentId: input.route.deploymentId,
    network: input.route.source.network,
    amount: input.amount,
    sender: input.evmAddress,
    recipient: input.midenAccount,
  }, "Enter a valid Circle deposit route and sender.");
  parseArcAmount(request.amount);
  arcRecipient(request.recipient);
  const quote = await fetchCctpQuote(request, signal);
  return {
    kind: "cctp",
    received: input.amount,
    fee: formatUnits(BigInt(quote.fee), 6),
    validity: { kind: "provider" },
    authorization: quote,
  };
}
