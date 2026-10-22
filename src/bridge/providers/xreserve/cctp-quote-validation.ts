import { pad } from "viem";
import { arcConfig } from "./config";
import { cctpConfig, cctpSource } from "./cctp-config";
import { cctpDepositHook } from "./cctp-hook";
import { parseArcAmount } from "./deposit";
import type { CctpQuote, CctpQuoteExpiry } from "./cctp-quote";

export type CctpQuoteValidation = { claimable: boolean; secondsRemaining: number };
type ExpiryStatus = CctpQuoteExpiry & { expired: boolean; secondsRemaining: number };

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isExpiryStatus(value: unknown): value is ExpiryStatus {
  if (!value || typeof value !== "object") return false;
  const expiry = value as Record<string, unknown>;
  if (typeof expiry.expired !== "boolean" || !isNonnegativeInteger(expiry.secondsRemaining)) return false;
  if (expiry.mode === "TIMESTAMP") return isNonnegativeInteger(expiry.expiresAt);
  return expiry.mode === "BLOCK_NUMBER" && isNonnegativeInteger(expiry.expiresAtBlock) &&
    (expiry.blockEstimatedAt === undefined || isNonnegativeInteger(expiry.blockEstimatedAt));
}

/** Circle validates the signed quote against this exact burn and the source-chain tip. */
export async function requestCircleQuoteValidation(quote: CctpQuote): Promise<CctpQuoteValidation> {
  const ARC = arcConfig(quote.deploymentId);
  const source = cctpSource(quote.network, quote.deploymentId);
  const CCTP = cctpConfig(quote.deploymentId, quote.network);
  const response = await fetch(`${CCTP.api}/v2/quote/validate/usdc/${source.domain}`, {
    method: "POST", headers: { "content-type": "application/json" }, cache: "no-store",
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      abiSignature: "depositForBurnWithHookAndFees(uint256,uint32,bytes32,address,bytes32,bytes,(bytes,address))",
      args: [parseArcAmount(quote.amount).toString(), String(ARC.circleDomain), pad(CCTP.executor),
        source.asset.address, pad(CCTP.executor), cctpDepositHook(quote.sender, quote.recipient, quote.deploymentId),
        [quote.signedQuote, quote.sender]],
    }),
  });
  if (!response.ok) throw new Error("Circle could not validate this quote. Please retry.");
  const result = await response.json();
  // Never turn signature/binding failures or a malformed safety response into a
  // refresh. Only an otherwise valid, expired quote can be replaced automatically.
  if (!result || typeof result.signedQuote !== "string" ||
      result.signedQuote.toLowerCase() !== quote.signedQuote.toLowerCase() ||
      typeof result.feeToken !== "string" || result.feeToken.toLowerCase() !== source.asset.address.toLowerCase() ||
      result.feeTotalAmount !== quote.fee || result.nonce !== "0" ||
      typeof result.claimable !== "boolean" || !isExpiryStatus(result.expiry) ||
      !Array.isArray(result.failedChecks) || !result.failedChecks.every((check: unknown) => typeof check === "string" && check.length > 0) ||
      !Array.isArray(result.items) || result.items.length !== 2 ||
      !result.items.every((item: { type?: unknown; argsMatch?: unknown } | null) => item?.argsMatch === true) ||
      !result.items.some((item: { type?: unknown }) => item.type === "FORWARD") ||
      !result.items.some((item: { type?: unknown }) => item.type === "PRE_FINALITY"))
    throw new Error("Circle returned an invalid quote validation. Review the transfer again.");
  if (result.claimable) {
    if (result.expiry.expired || result.failedChecks.length !== 0)
      throw new Error("Circle returned an inconsistent quote validation. Please retry.");
  } else if (!result.expiry.expired || result.expiry.secondsRemaining !== 0 ||
      result.failedChecks.length !== 1 || result.failedChecks[0] !== "QUOTE_EXPIRED") {
    throw new Error("Circle rejected this quote. Review the transfer again.");
  }
  return { claimable: result.claimable, secondsRemaining: result.expiry.secondsRemaining };
}

export async function fetchCctpQuoteValidation(quote: CctpQuote): Promise<CctpQuoteValidation> {
  const response = await fetch("/api/xreserve/quote/validate", {
    method: "POST", headers: { "content-type": "application/json" }, cache: "no-store",
    body: JSON.stringify(quote), signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Circle quote validation unavailable.");
  if (!body || typeof body.claimable !== "boolean" || !isNonnegativeInteger(body.secondsRemaining))
    throw new Error("Circle returned an invalid quote validation. Please retry.");
  return { claimable: body.claimable, secondsRemaining: body.secondsRemaining };
}
