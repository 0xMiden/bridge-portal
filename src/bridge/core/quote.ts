import type { BridgeRoute } from "./routes";
import type { CctpQuote } from "../providers/xreserve/cctp-quote";
import type { WithdrawalQuote } from "../providers/xreserve/withdrawal-quote";

export type QuoteRequest = {
  route: BridgeRoute;
  amount: string;
  midenAccount: string;
  evmAddress: string;
};

/** Decimal amounts. Fees are added in the source token or deducted from the destination payout. */
export type QuoteResult = {
  received: string;
  fee?: string;
  expiresAt: number;
} & (
  | {
      kind: "epoch";
    }
  | {
      kind: "cctp";
      authorization: CctpQuote;
    }
  | {
      kind: "withdrawal";
      authorization: WithdrawalQuote;
    }
);

/** Bind a review to its route, amount and accounts, even if the wallet changes. */
export type TransferQuote = QuoteResult & {
  request: Omit<QuoteRequest, "route"> & { routeId: string; deploymentId?: string };
};
