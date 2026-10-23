import { queryOptions } from "@tanstack/react-query";
import { PRICE_REFRESH_MS, type PriceSymbol, type UsdPrice } from "./token-pricing";

/** Display estimates and deposit validation share the same market snapshots. */
export function usdPriceQuery(symbol: PriceSymbol | null) {
  return queryOptions({
    queryKey: ["usd-price", symbol],
    enabled: symbol !== null,
    queryFn: async ({ signal }): Promise<UsdPrice> => {
      const response = await fetch(`/api/prices?symbol=${symbol}`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
      });
      if (!response.ok) throw new Error("USD price unavailable. Try again shortly.");
      return response.json();
    },
    // The server may return an already-aged cached quote. Both freshness and
    // refresh timing follow that snapshot, not when the browser received it.
    staleTime: (query) => query.state.data
      ? Math.max(0, PRICE_REFRESH_MS - (query.state.dataUpdatedAt - query.state.data.fetchedAt))
      : PRICE_REFRESH_MS,
    refetchInterval: (query) => query.state.status === "error" ? PRICE_REFRESH_MS : Math.max(1_000,
      PRICE_REFRESH_MS - (Date.now() - (query.state.data?.fetchedAt ?? Date.now())) + 100),
    retry: false,
  });
}
