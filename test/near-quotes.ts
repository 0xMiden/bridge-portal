import { generateKeyPairSync, sign } from "node:crypto";
import { quoteHash, type QuoteResponse } from "@defuse-protocol/one-click-sdk-typescript";
import { formatUnits } from "viem";
import { nearRequest, nearRouteAssets } from "../src/bridge/providers/near/quote";
import type { NearQuoteResponse, NearInput, NearStatus } from "../src/bridge/providers/near/schema";

// Synthetic service key lives only in tests. Production always uses the SDK's pinned key.
const keys = generateKeyPairSync("ed25519");
function base58(bytes: Uint8Array): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
  let encoded = "";
  while (value > 0n) { encoded = alphabet[Number(value % 58n)] + encoded; value /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; encoded = "1" + encoded; }
  return encoded;
}
export const testManagerKey = `ed25519:${base58(keys.publicKey.export({ type: "spki", format: "der" }).subarray(-32))}`;
export const nearTestInput: NearInput = {
  routeId: "mainnet:near-miden-usdcx-to-base-usdc", mode: "send", amount: "5",
  midenAccount: "mm1aqu8zjdwvcgkeug5a67kpwmnsyv2qgp7_qr7qqq9wr6w",
  evmAddress: "0x1111111111111111111111111111111111111111",
};
export const nearReceiveInput: NearInput = { ...nearTestInput, routeId: "mainnet:near-base-usdc-to-miden-usdcx", mode: "receive" };
export function signedNearQuote(input = nearTestInput, dry = false, patch: Partial<NearQuoteResponse["quote"]> = {}, waitMs?: number): NearQuoteResponse {
  const { source } = nearRouteAssets(input.routeId);
  const request = nearRequest(input, dry, new Date(Date.now() + 600_000).toISOString());
  const response: NearQuoteResponse = {
    correlationId: "synthetic-near-quote", timestamp: new Date().toISOString(), signature: "",
    quoteRequest: { ...request, quoteWaitingTimeMs: waitMs ?? request.quoteWaitingTimeMs },
    quote: { amountIn: request.amount, amountInFormatted: formatUnits(BigInt(request.amount), source.decimals), amountInUsd: "5",
      minAmountIn: request.amount, amountOut: "4980000", amountOutFormatted: "4.98", amountOutUsd: "4.98", minAmountOut: "4930200",
      timeEstimate: 24, ...(dry ? {} : { depositAddress: input.mode === "send"
        ? "mm1apu8zjdwvcgkeug5a67kpwmnsynr09mq_qr7qqq9wr6w" : "0x3333333333333333333333333333333333333333", deadline: request.deadline }), ...patch },
  };
  response.signature = `ed25519:${base58(sign(null, Buffer.from(quoteHash(response as unknown as QuoteResponse)), keys.privateKey))}`;
  return response;
}
export const nearTxHash = `0x${"ab".repeat(32)}`;
export const nearDestinationHash = `0x${"cd".repeat(32)}`;
export function nearStatus(quote: NearQuoteResponse, status: NearStatus = "PENDING_DEPOSIT") {
  return { correlationId: "synthetic-status", quoteResponse: quote, status, updatedAt: new Date().toISOString(),
    swapDetails: { originChainTxHashes: [], destinationChainTxHashes: [] } };
}
