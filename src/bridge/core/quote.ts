import type { BridgeConfig } from "../../config/bridge-config";
import type { BridgeRoute } from "./routes";
import type { CctpQuote } from "../providers/xreserve/cctp-quote";
import type { WithdrawalQuote } from "../providers/xreserve/withdrawal-quote";
import type { ManualAuthorization } from "../providers/xreserve/helper-types";
import type { EvmNetwork, SolanaNetwork } from "./assets";
export type SourceIdentity = { runtime: "solana"; network: SolanaNetwork; address: string } | { runtime: "evm"; network: EvmNetwork; address: string };

export type QuoteRequest = {
  route: BridgeRoute;
  amount: string;
  midenAccount: string;
  evmAddress: string;
  sourceIdentity?: SourceIdentity;
};

/** Review deadlines and provider authorizations have different validity rules. */
export type QuoteValidity =
  | { kind: "time"; expiresAt: number }
  | { kind: "provider" };

/** Decimal amounts. Fees are added in the source token or deducted from the destination payout. */
export type QuoteResult = {
  received: string;
  fee?: string;
  validity: QuoteValidity;
} & (
  | {
      kind: "epoch";
    }
  | {
      kind: "agglayer" | "arc-deposit";
    }
  | {
      kind: "cctp";
      authorization: CctpQuote;
    }
  | {
      kind: "cctp-helper";
      authorization: ManualAuthorization;
      sourceFeeLamports: string;
      eventRentLamports: string;
    }
  | {
      kind: "withdrawal";
      authorization: WithdrawalQuote;
    }
);

export function sameSourceIdentity(left?: SourceIdentity, right?: SourceIdentity) {
  if (!left || !right) return left === right;
  return left.runtime === right.runtime && left.network === right.network && (left.runtime === "solana" ? left.address === right.address : left.address.toLowerCase() === right.address.toLowerCase());
}

/** Provider authorizations are checked against their chain when submitted. */
export function isQuoteReviewable(quote: QuoteResult | null | undefined): quote is QuoteResult {
  return Boolean(quote && (quote.validity.kind === "provider" || quote.validity.expiresAt > Date.now()));
}

/** Bind a review to its route, amount and accounts, even if the wallet changes. */
export type TransferQuote = QuoteResult & {
  request: Omit<QuoteRequest, "route"> & { routeId: string; recovery?: BridgeConfig };
};
