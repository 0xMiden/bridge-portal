import type { PublicClient } from "viem";
import { cctpAbi, cctpConfig, cctpSource } from "./cctp-config";
import { assertCctpQuoteMatches, fetchCctpQuote, type CctpQuote, type CctpQuoteRequest } from "./cctp-quote";
import { fetchCctpQuoteValidation } from "./cctp-quote-validation";

// Circle Bridge Kit 1.16.0 requires >30 seconds against the source-chain tip.
// https://unpkg.com/@circle-fin/bridge-kit@1.16.0/index.mjs
const QUOTE_HEADROOM_SECONDS = 30;

/** Policy for one reviewed transfer: immutable terms, fee ceiling and quote reuse. */
export class CctpQuotePolicy {
  constructor(
    private readonly request: CctpQuoteRequest,
    private readonly reviewedFee: bigint,
    private readonly client: Pick<PublicClient, "readContract">,
  ) {}

  async verifyAuthorization(quote: CctpQuote) {
    assertCctpQuoteMatches(quote, this.request);
    const cctp = cctpConfig(this.request.deploymentId, this.request.network);
    const source = cctpSource(this.request.network, this.request.deploymentId);
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
