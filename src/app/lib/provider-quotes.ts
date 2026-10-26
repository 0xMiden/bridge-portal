import { queryOptions, type UseQueryResult } from "@tanstack/react-query";
import { sameAsset } from "../../bridge/core/assets";
import { isQuoteReviewable, type QuoteRequest, type TransferQuote } from "../../bridge/core/quote";
import { routeEnvironment, routesForEnvironment, type BridgeRoute } from "../../bridge/core/routes";
import { isValidAmount, validateTransferAmount } from "../../bridge/core/rules";
import { bridgeProviders } from "../../bridge/providers/registry";
import { quoteTransfer } from "../../bridge/quotes";

export type ProviderQuote = { route: BridgeRoute; quote: TransferQuote };

/** Keep a quoted selection; otherwise use the first available payout. */
export function selectedProviderQuote(route: BridgeRoute, offers: ProviderQuote[]): ProviderQuote | undefined {
  return offers.find(offer => offer.route.id === route.id) ?? offers[0];
}

/** Compare providers only when both exact assets and the transfer direction match. */
export function providerQuoteRequests(input: QuoteRequest): QuoteRequest[] {
  const { route } = input;
  return routesForEnvironment(routeEnvironment(route))
    .filter(candidate => !candidate.disabled && !bridgeProviders[candidate.provider].disabled &&
      candidate.mode === route.mode && sameAsset(candidate.source, route.source) &&
      sameAsset(candidate.destination, route.destination))
    .map(candidate => ({ ...input, route: candidate }));
}

export function transferQuoteOptions(input: QuoteRequest, frozen: boolean) {
  let valid = false;
  try { validateTransferAmount(input.route, input.amount); valid = true; } catch { /* Wait for a valid amount. */ }
  return queryOptions({
    queryKey: ["transfer-quote", input],
    enabled: !frozen && valid && Boolean(input.midenAccount && input.evmAddress),
    queryFn: async ({ signal }) => {
      // Cancel the typing delay and discard late responses when the request changes.
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 400);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(signal.reason);
        }, { once: true });
      });
      return quoteTransfer(input, signal);
    },
    staleTime: 0,
    refetchInterval: frozen ? false : 45_000,
    retry: false,
  });
}

/** A failed refresh, absent payout, or obsolete request must never become an offer. */
export function availableProviderQuotes(
  requests: QuoteRequest[],
  results: Pick<UseQueryResult<TransferQuote | null>, "data" | "isSuccess">[],
): ProviderQuote[] {
  return requests.flatMap((input, index) => {
    const result = results[index];
    const quote = result?.data;
    if (!result?.isSuccess || !isQuoteReviewable(quote) || !isValidAmount(quote.received)) return [];
    if (quote.request.routeId !== input.route.id || quote.request.amount !== input.amount ||
      quote.request.midenAccount !== input.midenAccount ||
      quote.request.evmAddress.toLowerCase() !== input.evmAddress.toLowerCase()) return [];
    return [{ route: input.route, quote }];
  });
}
