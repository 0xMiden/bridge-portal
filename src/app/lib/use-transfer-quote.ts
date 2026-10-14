"use client";
import { useQuery } from "@tanstack/react-query";
import type { QuoteRequest } from "../../bridge/core/quote";
import { isValidAmount } from "../../bridge/core/rules";
import { directionFor } from "../../bridge/providers/registry";
import { quoteTransfer } from "../../bridge/quotes";

/** All fee models share caching, cancellation, refresh and the frozen review. */
export function useTransferQuote(input: QuoteRequest, frozen: boolean) {
  const required = directionFor(input.route).fees(input.route).requiresQuote;
  return useQuery({
    queryKey: ["transfer-quote", input],
    enabled:
      required &&
      !frozen &&
      isValidAmount(input.amount) &&
      Boolean(input.midenAccount && input.evmAddress),
    queryFn: async ({ signal }) => {
      // Debounce typing. Consuming the signal cancels obsolete requests and delays.
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 400);
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(signal.reason);
          },
          { once: true },
        );
      });
      return quoteTransfer(input, signal);
    },
    staleTime: 30000,
    refetchInterval: frozen ? false : 45000,
    retry: false,
  });
}
