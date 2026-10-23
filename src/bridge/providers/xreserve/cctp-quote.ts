import { configKey } from "../../../config/bridge-config";
import { formatUnits, type PublicClient } from "viem";
import type { QuoteRequest, QuoteResult } from "../../core/quote";
import { normalizeMidenAccountHex } from "../agglayer/agglayer";
import { cctpAbi, cctpConfig, cctpSource } from "./config";
import { arcRecipient, parseArcAmount } from "./deposit-terms";
import {
  assertQuoteExpiry, cctpQuoteSchema, cctpRequestSchema, cctpValidationSchema,
  type CctpBurnIntent, type CctpBurnAuthorization, type CctpQuote, type CctpQuoteValidation,
} from "./cctp-schema";
import { circleApiError, parseCirclePayload } from "./circle-response";

export type { CctpQuote, CctpQuoteExpiry } from "./cctp-schema";
export type CctpQuoteRequest = CctpBurnIntent;

// Circle Bridge Kit 1.16.0 requires >30 seconds against the source-chain tip.
// https://unpkg.com/@circle-fin/bridge-kit@1.16.0/index.mjs
const QUOTE_HEADROOM_SECONDS = 30;

/** A quote authorizes one route, wallet pair, and amount. */
export function assertCctpQuoteMatches(candidate: CctpBurnIntent, request: CctpBurnIntent): void {
  if (candidate.network !== request.network || configKey(candidate.recovery) !== configKey(request.recovery)) {
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
function parseCctpQuote(value: unknown, request: CctpQuoteRequest): CctpQuote {
  const quote = parseCirclePayload(cctpQuoteSchema, value, "Circle returned an invalid quote. Please retry.");
  assertCctpQuoteMatches(quote, request);
  assertQuoteExpiry(quote);
  return quote;
}

async function fetchCctpQuote(input: CctpQuoteRequest, signal?: AbortSignal): Promise<CctpQuote> {
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

async function fetchCctpQuoteValidation(quote: CctpBurnAuthorization): Promise<CctpQuoteValidation> {
  const response = await fetch("/api/xreserve/quote/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(quote),
    signal: AbortSignal.timeout(15_000),
  });
  const body: unknown = await response.json();
  if (!response.ok) throw circleApiError(body, "Circle quote validation unavailable. Please retry shortly.");
  return parseCirclePayload(cctpValidationSchema, body, "Circle returned an invalid quote validation. Please retry.");
}

/** Policy for one reviewed transfer: immutable terms, fee ceiling and quote reuse. */
export class CctpQuotePolicy {
  constructor(
    private readonly request: CctpQuoteRequest,
    private readonly reviewedFee: bigint,
    private readonly client: Pick<PublicClient, "readContract">,
  ) {}

  async verifyAuthorization(quote: CctpQuote) {
    assertCctpQuoteMatches(quote, this.request);
    const cctp = cctpConfig(this.request.recovery, this.request.network);
    const source = cctpSource(this.request.network, this.request.recovery);
    const [fee, token] = await this.client.readContract({
      address: cctp.tokenMessengerWithFees, abi: cctpAbi,
      functionName: "getFee", args: [quote.signedQuote],
    });
    if (token.toLowerCase() !== source.asset.address.toLowerCase() || fee.toString() !== quote.fee) {
      throw new Error("Circle's signed quote does not match its fee. Review the transfer again.");
    }
    if (fee > this.reviewedFee) {
      throw new Error("Circle's fee increased. Review the updated fee before sending.");
    }
  }

  /** Monotonic deadline includes validation latency and subsequent wallet checks. */
  async submissionDeadline(quote: CctpQuote): Promise<number> {
    const started = performance.now();
    const validation = await fetchCctpQuoteValidation(quote);
    if (!validation.claimable) return -Infinity;
    return started + (validation.secondsRemaining - QUOTE_HEADROOM_SECONDS) * 1000;
  }

  hasSubmissionWindow(deadline: number): boolean {
    return performance.now() < deadline;
  }

  async refresh(): Promise<CctpQuote> {
    const quote = await fetchCctpQuote(this.request);
    await this.verifyAuthorization(quote);
    const deadline = await this.submissionDeadline(quote);
    if (!this.hasSubmissionWindow(deadline)) {
      throw new Error("Circle's quote expires too soon. Please review the transfer again.");
    }
    return quote;
  }

  async reuseOrRefresh(quote: CctpQuote): Promise<CctpQuote> {
    const deadline = await this.submissionDeadline(quote);
    return this.hasSubmissionWindow(deadline) ? quote : this.refresh();
  }
}

export async function quoteTransfer(input: QuoteRequest, signal: AbortSignal): Promise<QuoteResult> {
  const request = parseCirclePayload(cctpRequestSchema, {
    recovery: input.route.recovery,
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
