"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useState, type ReactNode } from "react";
import { BalanceStore } from "./balance-store";
import { midenBalanceKey } from "./miden-balances";
import { SEPOLIA_ETH, type EvmAsset, type MidenAsset } from "./core/assets";

const BalanceContext = createContext<BalanceStore | null>(null);

export function BalanceProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [store] = useState(() => new BalanceStore(client));
  return <BalanceContext.Provider value={store}>{children}</BalanceContext.Provider>;
}

export function useBalanceStore() {
  const store = useContext(BalanceContext);
  if (!store) throw new Error("Balance hooks require BalanceProvider");
  return store;
}

/** Subscribing, remounting, focusing, and reconnecting never request private data. */
export function useMidenBalances(account: string, network: MidenAsset["network"]) {
  const store = useBalanceStore();
  const query = useQuery(store.midenQuery(account, network));
  return {
    balances: query.isError ? undefined : query.data,
    loading: query.isFetching,
    error: query.error,
    show: () => store.requestMiden(account, network),
    refresh: () => store.requestMiden(account, network, true),
  };
}

export function useMidenBalance(account: string, asset: MidenAsset | undefined) {
  const result = useMidenBalances(asset ? account : "", asset?.network ?? "miden-testnet");
  return { ...result, balance: asset ? result.balances?.[midenBalanceKey(account, asset)] : undefined };
}

export function useEvmBalance(account: string, asset: EvmAsset | undefined) {
  const store = useBalanceStore();
  const query = useQuery(store.evmQuery(asset ? account : "", asset ?? SEPOLIA_ETH));
  return {
    balance: query.isError || !account || !asset ? undefined : query.data,
    loading: query.isFetching,
    error: query.error,
  };
}
