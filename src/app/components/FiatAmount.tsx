"use client";

import { useBridgeEnvironment } from "./NetworkProvider";
import { useQuery } from "@tanstack/react-query";
import { formatUsdAmount, priceSymbol } from "../lib/token-pricing";
import { usdPriceQuery } from "../lib/usd-price-query";

export function FiatAmount({ amount, symbol }: { amount: string; symbol: string }) {
  const environment = useBridgeEnvironment();
  const marketSymbol = priceSymbol(symbol);
  const price = useQuery(usdPriceQuery(marketSymbol));

  const unavailable = price.isError || price.fetchStatus === "paused";
  const value = formatUsdAmount(amount, unavailable ? undefined : price.data?.usd);
  const loading = amount === "…" || price.isLoading;
  const title = value !== null
    ? `${value} estimated using the ${marketSymbol ?? symbol}/USD market price from Coinbase.${environment === "testnet" ? " Testnet tokens have no real USD value." : ""}`
    : loading ? "Loading USD estimate…" : `USD estimate unavailable for ${symbol}.`;

  return <small className="fiat-amount" title={title}>{value ?? (loading ? "…" : "—")}</small>;
}
