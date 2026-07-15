"use client";

import { useEffect } from "react";
import { useAccount, useConnect } from "wagmi";
import { publishE2E } from "../lib/e2e/window-hook";

// E2E-only: auto-connects the headless test-wallet connector (registered in
// appkit-config when the flag is set) so the app is "connected" without a
// MetaMask popup, and publishes the EVM leg of window.__E2E__. Rendered by
// Providers only under NEXT_PUBLIC_E2E_TEST; returns null.
export function E2EAutoConnect() {
  const { connect, connectors } = useConnect();
  const { address, isConnected } = useAccount();

  useEffect(() => {
    if (isConnected) return;
    const connector = connectors.find((c) => c.id === "e2e-injected");
    if (connector) connect({ connector });
  }, [connect, connectors, isConnected]);

  useEffect(() => {
    publishE2E({
      evmAddress: address,
      evmReady: Boolean(isConnected && address),
    });
  }, [address, isConnected]);

  return null;
}
