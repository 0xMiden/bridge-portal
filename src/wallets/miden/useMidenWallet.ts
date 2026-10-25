"use client";

import { createContext, useContext, useSyncExternalStore } from "react";
import { useMidenBalances } from "../../bridge/BalanceProvider";
import { midenNetworks } from "../../config/environment";
import type { MidenWalletSession } from "./miden-wallet-session";

// Safe for SSR consumers: SDK types are erased and the adapter loads at the root.
export const MidenWalletContext = createContext<MidenWalletSession | null>(null);

export function useMidenWallet() {
  const session = useContext(MidenWalletContext);
  if (!session) throw new Error("useMidenWallet requires MidenWalletProvider");
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const balances = useMidenBalances(snapshot.connected ? snapshot.address : "", midenNetworks[session.environment].network);
  const heldAssets = Object.values(balances.balances ?? {}).flatMap(asset => asset && asset.amountRaw > 0n ? [asset] : []);
  const balanceText = !snapshot.connected ? "Not connected"
    : balances.loading ? "Syncing assets"
    : balances.error ? "Balance sync unavailable"
    : balances.balances ? heldAssets.map(asset => `${asset.balance} ${asset.symbol}`).join(" · ") || "No bridge assets"
    : "Connected";
  return { ...snapshot, balanceText, connect: session.connect, reconnect: session.reconnect,
    disconnect: session.disconnect, reset: session.reset, refresh: session.refresh };
}
