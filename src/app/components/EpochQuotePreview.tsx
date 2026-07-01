"use client";

import { RefreshCcw } from "lucide-react";
import { useEpochQuote } from "../lib/epoch/use-epoch-quote";

/**
 * Live Epoch "you receive ~N" preview for the swap box's Expected field.
 *
 * Loaded via `dynamic(..., { ssr: false })` so its transitive
 * `@miden-sdk/miden-sdk` (eager WASM) + Epoch SDK imports stay out of SSR —
 * mirrors how MidenWalletButton is mounted. Falls back to the caller's mock
 * estimate while idle so the field is never empty.
 */
export function EpochQuotePreview({
  mode,
  amount,
  midenAccount,
  evmAddress,
  fallback,
}: {
  mode: "receive" | "send";
  amount: string;
  midenAccount: string;
  evmAddress: string;
  fallback: string;
}) {
  const quote = useEpochQuote({ enabled: true, mode, amount, midenAccount, evmAddress });

  if (quote.loading) {
    return (
      <span className="epoch-quote-loading">
        <RefreshCcw size={14} className="animate-spin" aria-hidden="true" />
        Fetching quote…
      </span>
    );
  }

  if (quote.amount) {
    return (
      <>
        {quote.amount} {quote.symbol}
      </>
    );
  }

  if (quote.error) {
    // Distinguish the allocator's "no quote available" (no solver liquidity for
    // this token/amount right now — retryable) from an actual integration error.
    const noLiquidity = /quote isn'?t available|not available/i.test(quote.error);
    return (
      <span className="epoch-quote-error" title={quote.error}>
        {noLiquidity ? "No quote right now" : "Quote error"}
      </span>
    );
  }

  return <>{fallback}</>;
}
