"use client";

import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useBalanceStore, useMidenBalances } from "../../bridge/BalanceProvider";
import { evaluateBalanceCap, priceSymbolsForBalanceCap } from "../../bridge/core/balance-cap";
import type { BridgeRoute } from "../../bridge/core/routes";
import type { PriceSymbol, UsdPrice } from "./token-pricing";
import { usdPriceQuery } from "./usd-price-query";

export function useBalanceCap(route: BridgeRoute, amount: string, account: string) {
  const store = useBalanceStore();
  const client = useQueryClient();
  const network = route.destination.kind === "miden" ? route.destination.network : route.source.network;
  // A send has no deposit gate and must remain available during pricing outages.
  const enabled = route.mode === "receive" && route.destination.kind === "miden" && Boolean(account);
  const midenNetwork = network === "miden-mainnet" ? "miden-mainnet" : "miden-testnet";
  const balances = useMidenBalances(enabled ? account : "", midenNetwork);
  const symbols = enabled ? priceSymbolsForBalanceCap(route, balances.balances) : [];
  const queries = useQueries({ queries: symbols.map(usdPriceQuery) });
  const prices: Partial<Record<PriceSymbol, UsdPrice>> = {};
  queries.forEach((query, index) => {
    if (!query.isError && query.fetchStatus !== "paused" && query.data) prices[symbols[index]] = query.data;
  });
  // Wait for the initial wallet read and all price refreshes, including the
  // short gap between a cached price expiring and its scheduled refetch.
  const checking = enabled && (
    balances.loading || (!balances.balances && !balances.error) || queries.some(query =>
      query.isFetching || (query.isSuccess && query.fetchStatus !== "paused" && query.isStale),
    )
  );
  const result = evaluateBalanceCap(route, amount, balances.balances, prices);

  async function refresh() {
    const refreshed = await store.requestMiden(account, midenNetwork, true);
    await Promise.allSettled(priceSymbolsForBalanceCap(route, refreshed).map(symbol =>
      client.fetchQuery({ ...usdPriceQuery(symbol), staleTime: 0 }),
    ));
  }

  /** Called at confirmation; never trusts the balance captured when review opened. */
  async function verifyBalanceCap(transferRoute: BridgeRoute, transferAmount: string, transferAccount: string) {
    if (transferRoute.mode !== "receive" || transferRoute.destination.kind !== "miden") return;
    const destinationNetwork = transferRoute.destination.network;
    const freshBalances = await store.requestMiden(transferAccount, destinationNetwork, true);
    const freshPrices: Partial<Record<PriceSymbol, UsdPrice>> = {};
    const requestedSymbols = priceSymbolsForBalanceCap(transferRoute, freshBalances);
    // Failed holding prices are omitted; the evaluator still requires the
    // deposit's own price and includes every holding that could be priced.
    await Promise.allSettled(requestedSymbols.map(async symbol => {
      freshPrices[symbol] = await client.fetchQuery({ ...usdPriceQuery(symbol), staleTime: 0 });
    }));
    // Reject a disconnect/account switch, or a sync/reconnect that adds holdings
    // whose prices we never requested. Existing markets use the latest balances.
    const currentBalances = await store.requestMiden(transferAccount, destinationNetwork);
    if (priceSymbolsForBalanceCap(transferRoute, currentBalances).some(symbol => !requestedSymbols.includes(symbol))) {
      throw new Error("Your wallet balance changed. Review the transfer again.");
    }
    const verdict = evaluateBalanceCap(transferRoute, transferAmount, currentBalances, freshPrices);
    if (verdict.error) throw new Error(verdict.error);
  }

  return { ...result, checking, enabled, refresh, verifyBalanceCap };
}
