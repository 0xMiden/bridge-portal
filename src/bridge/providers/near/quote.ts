import { QuoteRequest as OneClickQuoteRequest, verifyQuoteSignature, type QuoteResponse } from "@defuse-protocol/one-click-sdk-typescript";
import { formatUnits } from "viem";
import { bitcoinAddressSchema, bitcoinTxHashSchema } from "../../bitcoin/address";
import { isEvmAsset, type BridgeAsset } from "../../core/assets";
import { transactionHashSchema } from "../../evm/evm-schema";
import { nearConfig, nearReceiptPairs } from "../../../config/near/config";
import type { QuoteRequest, QuoteResult } from "../../core/quote";
import { nearInputSchema, nearQuoteSchema, nearMidenAddress, nearEvmAddress, type NearInput, type NearQuoteResponse } from "./schema";

const MIDEN_MAX_AMOUNT = (1n << 63n) - (1n << 31n);

export function nearPair(routeId: string) {
  const pair = nearConfig.routes.find(pair => pair.id === routeId || pair.receiveId === routeId);
  if (!pair) throw new Error("Unsupported NEAR route. Choose an approved Miden token pair.");
  return pair;
}

function directedAssets(routeId: string, pair: ReturnType<typeof nearPair>) {
  return pair.id === routeId
    ? { mode: "send" as const, source: pair.source, destination: pair.destination }
    : { mode: "receive" as const, source: pair.destination, destination: pair.source };
}

export function nearRouteAssets(routeId: string) {
  return directedAssets(routeId, nearPair(routeId));
}

export function nearReceiptAssets(routeId: string, quote: NearQuoteResponse) {
  for (const pair of nearReceiptPairs) {
    if (pair.id !== routeId && pair.receiveId !== routeId) continue;
    const assets = directedAssets(routeId, pair);
    if (assets.source.assetId === quote.quoteRequest.originAsset && assets.destination.assetId === quote.quoteRequest.destinationAsset) return assets;
  }
  throw new Error("NEAR receipt does not match a released route.");
}

/** parseUnits rounds extra precision; transfers must reject it instead. */
export function nearSourceUnits(amount: string, decimals: number): string {
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(amount) || (amount.split(".")[1]?.length ?? 0) > decimals) {
    throw new Error(`Enter an amount with at most ${decimals} decimal places.`);
  }
  const [whole, fraction = ""] = amount.split(".");
  const units = BigInt(whole + fraction.padEnd(decimals, "0"));
  if (units <= 0n || units > (1n << 256n) - 1n) throw new Error("Amount is outside the transfer limits.");
  return units.toString();
}

export function nearRequest(input: NearInput, dry: boolean, deadline: string, pair = nearRouteAssets(input.routeId)) {
  if (input.mode !== pair.mode) throw new Error("NEAR route direction mismatch.");
  const external = pair.mode === "send" ? pair.destination : pair.source;
  const address = addressSchemaFor(external).parse(input.externalAddress);
  const amount = nearSourceUnits(input.amount, pair.source.decimals);
  if (pair.mode === "send" && BigInt(amount) > MIDEN_MAX_AMOUNT) throw new Error("Amount is outside Miden's transfer limits.");
  return {
    dry, swapType: OneClickQuoteRequest.swapType.EXACT_INPUT, slippageTolerance: 100 as const,
    originAsset: pair.source.assetId, destinationAsset: pair.destination.assetId,
    depositType: OneClickQuoteRequest.depositType.ORIGIN_CHAIN,
    recipientType: OneClickQuoteRequest.recipientType.DESTINATION_CHAIN,
    refundType: OneClickQuoteRequest.refundType.ORIGIN_CHAIN,
    amount, recipient: pair.mode === "send" ? address : input.midenAccount,
    refundTo: pair.mode === "send" ? input.midenAccount : address,
    confidentiality: OneClickQuoteRequest.confidentiality.BASIC, quoteWaitingTimeMs: 0, deadline,
  } satisfies OneClickQuoteRequest;
}

export function nearDepositWindow(routeId: string) {
  return nearRouteAssets(routeId).source.network === "bitcoin" ? 60 * 60_000 : 10 * 60_000;
}

export function nearQuoteExpiry(response: NearQuoteResponse) {
  return Math.min(
    Date.parse(response.quoteRequest.deadline),
    response.quote.deadline ? Date.parse(response.quote.deadline) : Infinity,
    response.quote.timeWhenInactive ? Date.parse(response.quote.timeWhenInactive) : Infinity,
    Date.parse(response.timestamp) + (response.quoteRequest.dry ? 60_000 : 10 * 60_000),
  );
}

function addressSchemaFor(asset: BridgeAsset) {
  if (isEvmAsset(asset)) return nearEvmAddress;
  if (asset.network === "bitcoin") return bitcoinAddressSchema;
  if (asset.kind === "miden") return nearMidenAddress;
  throw new Error("Unsupported NEAR address network.");
}

export function verifyNearQuote(value: unknown, input: NearInput, dry: boolean, requireLive = true): NearQuoteResponse {
  return verifySignedNearQuote(nearQuoteSchema.parse(value), input, dry, requireLive);
}

export function verifySignedNearQuote(response: NearQuoteResponse, input: NearInput, dry: boolean, requireLive = true): NearQuoteResponse {
  // The SDK pins the official manager public key; never accept one from a caller.
  if (!verifyQuoteSignature(response as unknown as QuoteResponse)) throw new Error("Invalid NEAR quote signature.");
  const pair = requireLive || dry ? nearRouteAssets(input.routeId) : nearReceiptAssets(input.routeId, response);
  const expected = nearRequest(input, dry, response.quoteRequest.deadline, pair);
  for (const [key, value] of Object.entries(expected)) {
    // Relay wait controls latency, not transfer terms. Its original value is
    // signature-verified above; saved quotes may predate the current policy.
    if (key === "quoteWaitingTimeMs") continue;
    if (response.quoteRequest[key] !== value) throw new Error("NEAR quote does not match this transfer. Review again.");
  }
  const quote = response.quote;
  if (quote.amountIn !== expected.amount || BigInt(quote.minAmountIn) > BigInt(expected.amount) ||
      BigInt(quote.minAmountOut) <= 0n || BigInt(quote.amountOut) < BigInt(quote.minAmountOut)) {
    throw new Error("NEAR returned invalid transfer amounts.");
  }
  if (input.mode === "receive" && BigInt(quote.amountOut) > MIDEN_MAX_AMOUNT) throw new Error("Output exceeds Miden's transfer limit.");
  if (!dry && !quote.depositAddress) throw new Error("NEAR did not return a deposit address.");
  if (quote.depositAddress) {
    addressSchemaFor(pair.source).parse(quote.depositAddress);
  }
  if (requireLive && (nearQuoteExpiry(response) <= Date.now() || Date.parse(response.timestamp) > Date.now() + 30_000)) {
    throw new Error("NEAR quote expired. Review a fresh quote before sending.");
  }
  return response;
}

export function nearInput(input: QuoteRequest): NearInput {
  return nearInputSchema.parse({ routeId: input.route.id, mode: input.route.mode, amount: input.amount,
    midenAccount: input.midenAccount, externalAddress: input.externalAddress });
}

export function validateNearDeposit(quote: NearQuoteResponse) {
  if (quote.quoteRequest.dry || !quote.quote.depositAddress) throw new Error("Review an executable NEAR quote before sending.");
  // Only simple deposits are supported. Never silently drop a provider memo.
  if (quote.quote.depositMemo || quote.quote.depositAttachment || quote.quote.attachment) {
    throw new Error("This NEAR deposit requires unsupported memo or attachment instructions. Do not fund it.");
  }
  if (quote.quoteRequest.depositMode && quote.quoteRequest.depositMode !== "SIMPLE") throw new Error("Unsupported NEAR deposit mode.");
  return quote.quote.depositAddress;
}

export function nearQuoteResult(response: NearQuoteResponse, routeId: string): QuoteResult {
  const decimals = nearRouteAssets(routeId).destination.decimals;
  return { kind: "near", received: formatUnits(BigInt(response.quote.amountOut), decimals),
    minimumReceived: formatUnits(BigInt(response.quote.minAmountOut), decimals), estimatedSeconds: response.quote.timeEstimate,
    validity: { kind: "time", expiresAt: nearQuoteExpiry(response) }, authorization: response };
}

/** Signed request values recover the original binding after a reload or route pause. */
export function nearTrackingInput(routeId: string, quote: NearQuoteResponse, { mode, source } = nearReceiptAssets(routeId, quote)): NearInput {
  return nearInputSchema.parse({ routeId, mode, amount: formatUnits(BigInt(quote.quoteRequest.amount), source.decimals),
    midenAccount: mode === "send" ? quote.quoteRequest.refundTo : quote.quoteRequest.recipient,
    externalAddress: mode === "send" ? quote.quoteRequest.recipient : quote.quoteRequest.refundTo });
}

export function validateNearTxHash(asset: BridgeAsset, hash: string) {
  if (asset.network === "bitcoin") return bitcoinTxHashSchema.parse(hash);
  if (isEvmAsset(asset) || asset.kind === "miden") return transactionHashSchema.parse(hash);
  throw new Error("Unsupported NEAR transaction network.");
}
