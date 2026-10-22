import type { QuoteRequest, QuoteResult } from "../../core/quote";
import { formatUnits, pad, type Address, type Hex } from "viem";
import { cctpConfig, cctpSource, isCctpNetwork, type CctpNetwork } from "./cctp-config";
import { cctpDepositHook } from "./cctp-hook";
import { arcConfig } from "./config";
import { arcRecipient, parseArcAmount } from "./deposit";

export type CctpQuoteRequest = { network: CctpNetwork; sender: Address; recipient: string; amount: string; deploymentId?: string };
export type CctpQuoteExpiry =
  | { mode: "TIMESTAMP"; expiresAt: number }
  | { mode: "BLOCK_NUMBER"; expiresAtBlock: number; blockEstimatedAt?: number };
export type CctpQuote = CctpQuoteRequest & {
  signedQuote: Hex;
  fee: string;
  /** Circle server time, in Unix seconds. */
  issuedAt: number;
  expiry: CctpQuoteExpiry;
  /** Display estimate in milliseconds; never authoritative for quote validity. */
  expiresAt: number;
};

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && value > 0 && Number.isSafeInteger(value * 1000) && Number.isSafeInteger(value);
}

function parseCircleExpiry(value: unknown, issuedAt: number): CctpQuoteExpiry {
  if (value && typeof value === "object") {
    const expiry = value as Record<string, unknown>;
    if (expiry.mode === "TIMESTAMP" && isTimestamp(expiry.expiresAt) && expiry.expiresAt > issuedAt)
      return { mode: "TIMESTAMP", expiresAt: expiry.expiresAt };
    if (expiry.mode === "BLOCK_NUMBER" && typeof expiry.expiresAtBlock === "number" &&
        Number.isSafeInteger(expiry.expiresAtBlock) && expiry.expiresAtBlock > 0 &&
        (expiry.blockEstimatedAt === undefined || isTimestamp(expiry.blockEstimatedAt)))
      return { mode: "BLOCK_NUMBER", expiresAtBlock: expiry.expiresAtBlock,
        ...(expiry.blockEstimatedAt === undefined ? {} : { blockEstimatedAt: expiry.blockEstimatedAt }) };
  }
  throw new Error("Circle returned invalid quote expiry metadata. Please retry.");
}

/** Public Circle API: the signed claim binds forwarding to this exact hook. */
export async function requestCircleQuote(input: CctpQuoteRequest): Promise<CctpQuote> {
  const ARC = arcConfig(input.deploymentId);
  const source = cctpSource(input.network, input.deploymentId);
  const CCTP = cctpConfig(input.deploymentId, input.network);
  const amount = parseArcAmount(input.amount).toString();
  const response = await fetch(`${CCTP.api}/v2/quote/burn/usdc/${source.domain}/${ARC.circleDomain}`, {
    method: "POST", headers: { "content-type": "application/json" }, cache: "no-store",
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({ amount, feeToken: source.asset.address, requests: [
      { type: "PRE_FINALITY" },
      { type: "FORWARD", params: { destinationCaller: pad(CCTP.executor), hookData: cctpDepositHook(input.sender, input.recipient, input.deploymentId) } },
    ] }),
  });
  if (!response.ok) throw new Error("Circle could not quote this transfer. Please retry.");
  const quote = await response.json();
  if (!quote || quote.burnAmount !== amount ||
      typeof quote.feeToken !== "string" || quote.feeToken.toLowerCase() !== source.asset.address.toLowerCase() ||
      typeof quote.feeTotalAmount !== "string" || !/^\d+$/.test(quote.feeTotalAmount) ||
      typeof quote.signedQuote !== "string" || !/^0x(?:[\da-f]{2})+$/i.test(quote.signedQuote) ||
      !isTimestamp(quote.issuedAt))
    throw new Error("Circle returned an invalid quote. Please retry.");
  const expiry = parseCircleExpiry(quote.expiry, quote.issuedAt);
  // Keep the API's actual expiry discriminator. A block-time estimate (and the
  // browser/server wall clock) cannot decide whether the source chain accepts it.
  const expiresAt = (expiry.mode === "TIMESTAMP" ? expiry.expiresAt : expiry.blockEstimatedAt ?? quote.issuedAt) * 1000;
  return { ...input, signedQuote: quote.signedQuote, fee: quote.feeTotalAmount,
    issuedAt: quote.issuedAt, expiry, expiresAt };
}

export async function fetchCctpQuote(input: CctpQuoteRequest, signal?: AbortSignal): Promise<CctpQuote> {
  const response = await fetch("/api/xreserve/quote", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input), signal,
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Circle quote unavailable.");
  return body;
}


export async function quoteTransfer(input: QuoteRequest, signal: AbortSignal): Promise<QuoteResult> {
  const network = input.route.source.network;
  if (!isCctpNetwork(network) || !/^0x[\da-f]{40}$/i.test(input.evmAddress)) throw new Error("Enter a valid Circle deposit route and sender.");
  parseArcAmount(input.amount);
  arcRecipient(input.midenAccount);
  const quote = await fetchCctpQuote({ deploymentId: input.route.deploymentId, network: network as CctpNetwork, amount: input.amount, sender: input.evmAddress as Address, recipient: input.midenAccount }, signal);
  return { kind: "cctp", received: input.amount, fee: formatUnits(BigInt(quote.fee), 6), expiresAt: quote.expiresAt, authorization: quote };
}
