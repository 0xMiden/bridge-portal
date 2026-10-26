"use client";

import { useBridgeEnvironment } from "./NetworkProvider";
import { useQuery } from "@tanstack/react-query";
import { formatUsdAmount, priceSymbol } from "../lib/token-pricing";
import { usdPriceQuery } from "../lib/usd-price-query";

const sizes = { field: "text-xs/normal", receipt: "text-sm", review: "text-sm" };

export function FiatAmount({ amount, symbol, size = "field" }: { amount: string; symbol: string; size?: keyof typeof sizes }) {
  const environment = useBridgeEnvironment();
  const marketSymbol = priceSymbol(symbol);
  const price = useQuery(usdPriceQuery(marketSymbol));

  const unavailable = price.isError || price.fetchStatus === "paused";
  const value = formatUsdAmount(amount, unavailable ? undefined : price.data?.usd);
  const loading = amount === "…" || price.isLoading;
  const title = value !== null
    ? `${value} estimated using the ${marketSymbol ?? symbol}/USD market price from Coinbase.${environment === "testnet" ? " Testnet tokens have no real USD value." : ""}`
    : loading ? "Loading USD estimate…" : `USD estimate unavailable for ${symbol}.`;

  return <small className={`fiat-amount min-w-0 truncate text-muted-foreground ${sizes[size]}`} title={title}>{value ?? (loading ? "…" : "—")}</small>;
}
