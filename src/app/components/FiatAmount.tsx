"use client";

import { useQuery } from "@tanstack/react-query";
import { formatUsdAmount, PRICE_REFRESH_MS, priceSymbol, type UsdPrice } from "../lib/token-pricing";

export function FiatAmount({ amount, symbol }: { amount: string; symbol: string }) {
  const marketSymbol = priceSymbol(symbol);
  const price = useQuery({
    // Both panels, networks and aliases share the same market price. Typing
    // changes only the local calculation, never the query or its cache key.
    queryKey: ["usd-price", marketSymbol],
    enabled: marketSymbol !== null,
    queryFn: async ({ signal }): Promise<UsdPrice> => {
      const response = await fetch(`/api/prices?symbol=${marketSymbol}`, { signal });
      if (!response.ok) throw new Error("USD price unavailable");
      return response.json();
    },
    staleTime: PRICE_REFRESH_MS,
    refetchInterval: PRICE_REFRESH_MS,
    retry: false,
  });

  const unavailable = price.isError || price.fetchStatus === "paused";
  const value = formatUsdAmount(amount, unavailable ? undefined : price.data?.usd);
  const loading = amount === "…" || price.isLoading;
  const title = value !== null
    ? `${value} estimated using the ${marketSymbol ?? symbol}/USD market price from Coinbase. Testnet tokens have no real USD value.`
    : loading ? "Loading USD estimate…" : `USD estimate unavailable for ${symbol}.`;

  return <small className="fiat-amount" title={title}>{value ?? (loading ? "…" : "—")}</small>;
}
