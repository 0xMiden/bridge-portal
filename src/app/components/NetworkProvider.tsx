"use client";

import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { isBridgeEnvironment, type BridgeEnvironment } from "../../config/environment";
import { loadStoredActivities } from "../lib/bridge-persistence";

const storageKey = "miden.bridge.ui.environment";
const changeEvent = "bridge-network-change";
let fallbackEnvironment: BridgeEnvironment = "testnet";

function selectEnvironment(environment: BridgeEnvironment) {
  fallbackEnvironment = environment;
  try {
    window.sessionStorage.setItem(storageKey, environment);
  } catch {
    // Keep the selector usable when browser storage is unavailable.
  }
  window.dispatchEvent(new Event(changeEvent));
}

function readEnvironment(pathname: string): BridgeEnvironment {
  // A receipt always uses its recorded deployment, regardless of the tab's
  // current selection. Normalization assigns pre-network receipts to testnet.
  const receipt = /^\/activity\/([^/]+)\/?$/.exec(pathname);
  if (receipt) {
    try {
      const activity = loadStoredActivities().find(item => item.id === decodeURIComponent(receipt[1]));
      if (activity?.environment) return activity.environment;
    } catch {
      // The receipt page handles missing or unreadable history.
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
  environment: "testnet" as BridgeEnvironment,
  selectEnvironment,
});
export const useBridgeEnvironment = () => useContext(NetworkContext).environment;
export const useSelectBridgeEnvironment = () => useContext(NetworkContext).selectEnvironment;

export function NetworkProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const environment = useSyncExternalStore(
    subscribe,
    () => readEnvironment(pathname),
    () => null,
  );
  // Resolve the saved network before mounting wallet sessions or balance stores.
  if (!environment) return null;
  return <NetworkContext.Provider value={{ environment, selectEnvironment }}>{children}</NetworkContext.Provider>;
}
