"use client";

import { RefreshCcw } from "lucide-react";
import { useEffect } from "react";
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
  hideSymbol = false,
  onAmount,
  onLoading,
}: {
  mode: "receive" | "send";
  amount: string;
  midenAccount: string;
  evmAddress: string;
  fallback: string;
  // When the caller renders the token symbol separately (as a unit pill), omit
  // it from the amount so it isn't doubled.
  hideSymbol?: boolean;
  // Lifts the live quote amount to the caller (e.g. to drive the Min-received
  // detail from the real Epoch API rather than a hardcoded estimate). Pass a
  // stable setter (e.g. a useState setter) to avoid effect churn.
  onAmount?: (amount: string | undefined) => void;
  // Lifts the in-flight state so the caller's CTA can show "Fetching quote…"
  // rather than reading as ready-to-transfer while a quote recomputes.
  onLoading?: (loading: boolean) => void;
}) {
  const quote = useEpochQuote({ enabled: true, mode, amount, midenAccount, evmAddress });

  useEffect(() => {
    onAmount?.(quote.amount);
  }, [onAmount, quote.amount]);

  useEffect(() => {
    onLoading?.(quote.loading);
  }, [onLoading, quote.loading]);

  // While a new quote is in flight (input changed → recomputing), show a
  // loading indicator rather than the previous amount, so the field visibly
  // "updates" instead of holding a stale value and then snapping to the new one.
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
        {quote.amount}
        {hideSymbol ? "" : ` ${quote.symbol}`}
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
