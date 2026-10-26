"use client";
import { useEffect, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import type { QuoteRequest } from "../../bridge/core/quote";
import { availableProviderQuotes, providerQuoteRequests, transferQuoteOptions } from "./provider-quotes";

/** Query every compatible provider independently; selection reuses the same quote. */
export function useTransferQuotes(input: QuoteRequest, frozen: boolean) {
  const requests = providerQuoteRequests(input);
  const options = requests.map(request => transferQuoteOptions(request, frozen));
  const results = useQueries({ queries: options });
  const offers = availableProviderQuotes(requests, results);
  const [, expire] = useState(0);
  const nextExpiry = Math.min(...offers.map(({ quote }) => quote.validity.kind === "time" ? quote.validity.expiresAt : Infinity));
  useEffect(() => {
    if (frozen || !Number.isFinite(nextExpiry)) return;
    const timer = setTimeout(() => expire(value => value + 1), Math.max(0, nextExpiry - Date.now()) + 1);
    return () => clearTimeout(timer);
  }, [nextExpiry, frozen]);

  return {
    offers,
    ready: frozen || options.some(option => option.enabled),
    loading: results.some(result => result.isFetching),
    query: results[requests.findIndex(request => request.route.id === input.route.id)],
    refetch: () => Promise.all(results.map(result => result.refetch())),
  };
}
