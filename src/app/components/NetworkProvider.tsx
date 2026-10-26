"use client";

import { createContext, useCallback, useContext, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { isBridgeEnvironment, type BridgeEnvironment } from "../../config/environment";
import { useActivitySnapshot } from "./ActivityProvider";
import type { ActivityReceipt } from "../../bridge/activity";

const storageKey = "miden.bridge.ui.environment";
const changeEvent = "bridge-network-change";
let fallbackEnvironment: BridgeEnvironment = "mainnet";

function selectEnvironment(environment: BridgeEnvironment) {
  fallbackEnvironment = environment;
  try {
    window.sessionStorage.setItem(storageKey, environment);
  } catch {
    // Keep the selector usable when browser storage is unavailable.
  }
  window.dispatchEvent(new Event(changeEvent));
}

function readEnvironment(pathname: string, receipts: readonly ActivityReceipt[]): BridgeEnvironment {
  // A receipt always uses its recorded network, regardless of the tab's selection.
  const receipt = /^\/activity\/([^/]+)\/?$/.exec(pathname);
  if (receipt) {
    try {
      const activity = receipts.find(item => item.activity.id === decodeURIComponent(receipt[1]))?.activity;
      if (activity?.environment) return activity.environment;
    } catch {
      // A malformed receipt URL cannot select a network.
    }
  }
  try {
    const saved = window.sessionStorage.getItem(storageKey);
    if (isBridgeEnvironment(saved)) return saved;
  } catch {
    // Fall back to the current in-memory selection.
  }
  return fallbackEnvironment;
}

function subscribe(listener: () => void) {
  window.addEventListener(changeEvent, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(changeEvent, listener);
    window.removeEventListener("storage", listener);
  };
}

const NetworkContext = createContext({
  environment: "mainnet" as BridgeEnvironment,
  selectEnvironment,
  selectionLocked: false,
  lockSelection: (): (() => void) => () => {},
});
export const useBridgeEnvironment = () => useContext(NetworkContext).environment;
export const useSelectBridgeEnvironment = () => useContext(NetworkContext).selectEnvironment;
export const useNetworkSelectionLocked = () => useContext(NetworkContext).selectionLocked;
export const useLockNetworkSelection = () => useContext(NetworkContext).lockSelection;

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [pendingSubmissions, setPendingSubmissions] = useState(0);
  const lockSelection = useCallback(() => {
    setPendingSubmissions(count => count + 1);
    return () => setPendingSubmissions(count => count - 1);
  }, []);
  const pathname = usePathname();
  const { ready, receipts } = useActivitySnapshot();
  const environment = useSyncExternalStore(
    subscribe,
    () => readEnvironment(pathname, receipts),
    () => null,
  );
  // Resolve the saved network before mounting wallet sessions or balance stores.
  if (!ready || !environment) return null;
  return <NetworkContext.Provider value={{ environment, selectEnvironment, selectionLocked: pendingSubmissions > 0, lockSelection }}>{children}</NetworkContext.Provider>;
}
