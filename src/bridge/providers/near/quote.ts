import { verifyQuoteSignature, type QuoteResponse } from "@defuse-protocol/one-click-sdk-typescript";
import { formatUnits } from "viem";
import { nearConfig } from "../../../config/near/config";
import type { QuoteRequest, QuoteResult } from "../../core/quote";
import { nearInputSchema, nearQuoteSchema, type NearInput, type NearQuoteResponse } from "./schema";

export function nearPair(routeId: string) {
  const pair = nearConfig.routes.find(pair => pair.id === routeId);
  if (!pair) throw new Error("Unsupported NEAR route. Only approved Miden to EVM routes are available.");
  return pair;
}

/** parseUnits rounds extra precision; transfers must reject it instead. */
export function nearSourceUnits(amount: string, decimals: number): string {
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(amount) || (amount.split(".")[1]?.length ?? 0) > decimals) {
    throw new Error(`Enter an amount with at most ${decimals} decimal places.`);
  }
  const [whole, fraction = ""] = amount.split(".");
  const units = BigInt(whole + fraction.padEnd(decimals, "0"));
  if (units <= 0n || units > (1n << 63n) - (1n << 31n)) throw new Error("Amount is outside Miden's transfer limits.");
  return units.toString();
}

export function nearRequest(input: NearInput, dry: boolean, deadline: string) {
  const pair = nearPair(input.routeId);
  return {
    dry, swapType: "EXACT_INPUT" as const, slippageTolerance: 100 as const,
    originAsset: pair.source.assetId, destinationAsset: pair.destination.assetId,
    depositType: "ORIGIN_CHAIN" as const, recipientType: "DESTINATION_CHAIN" as const, refundType: "ORIGIN_CHAIN" as const,
    amount: nearSourceUnits(input.amount, pair.source.decimals), recipient: input.evmAddress, refundTo: input.midenAccount,
    confidentiality: "basic" as const, quoteWaitingTimeMs: 10_000, deadline,
  };
}

export function nearQuoteExpiry(response: NearQuoteResponse) {
  return Math.min(
    Date.parse(response.quoteRequest.deadline),
    Date.parse(response.timestamp) + (response.quoteRequest.dry ? 60_000 : 10 * 60_000),
    response.quote.deadline ? Date.parse(response.quote.deadline) : Infinity,
  );
}

export function verifyNearQuote(value: unknown, input: NearInput, dry: boolean, requireLive = true): NearQuoteResponse {
  const response = nearQuoteSchema.parse(value);
  // The SDK pins the official manager public key; never accept one from a caller.
  if (!verifyQuoteSignature(response as unknown as QuoteResponse)) throw new Error("Invalid NEAR quote signature.");
  const expected = nearRequest(nearInputSchema.parse(input), dry, response.quoteRequest.deadline);
  for (const [key, value] of Object.entries(expected)) {
    if (response.quoteRequest[key] !== value) throw new Error("NEAR quote does not match this transfer. Review again.");
  }
  const quote = response.quote;
  if (quote.amountIn !== expected.amount || BigInt(quote.minAmountIn) > BigInt(expected.amount) ||
      BigInt(quote.minAmountOut) <= 0n || BigInt(quote.amountOut) < BigInt(quote.minAmountOut)) {
    throw new Error("NEAR returned invalid transfer amounts.");
  }
  if (!dry && !quote.depositAddress) throw new Error("NEAR did not return a Miden deposit address.");
  if (requireLive && (nearQuoteExpiry(response) <= Date.now() || Date.parse(response.timestamp) > Date.now() + 30_000)) {
    throw new Error("NEAR quote expired. Review a fresh quote before sending.");
  }
  return response;
}

export function nearInput(input: QuoteRequest): NearInput {
  return nearInputSchema.parse({ routeId: input.route.id, mode: input.route.mode, amount: input.amount,
    midenAccount: input.midenAccount, evmAddress: input.evmAddress });
}

export function nearQuoteResult(response: NearQuoteResponse, routeId: string): QuoteResult {
  const decimals = nearPair(routeId).destination.decimals;
  return { kind: "near", received: formatUnits(BigInt(response.quote.amountOut), decimals),
    minimumReceived: formatUnits(BigInt(response.quote.minAmountOut), decimals), estimatedSeconds: response.quote.timeEstimate,
    validity: { kind: "time", expiresAt: nearQuoteExpiry(response) }, authorization: response };
}

/** Signed request values recover the original binding after a reload or route pause. */
export function nearTrackingInput(routeId: string, quote: NearQuoteResponse): NearInput {
  return nearInputSchema.parse({ routeId, mode: "send", amount: formatUnits(BigInt(quote.quoteRequest.amount), nearPair(routeId).source.decimals),
    midenAccount: quote.quoteRequest.refundTo, evmAddress: quote.quoteRequest.recipient });
}
