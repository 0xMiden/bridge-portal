"use client";

import {
  AllowedPrivateData,
  PrivateDataPermission,
  WalletAdapterNetwork,
} from "@miden-sdk/miden-wallet-adapter-base";
import { MidenFiSignerProvider, useMidenFiWallet } from "@miden-sdk/miden-wallet-adapter-react";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useBalanceStore } from "../../bridge/BalanceProvider";
import { useBridgeEnvironment } from "../../app/components/NetworkProvider";
import { midenNetworks } from "../../config/environment";
import { assertMidenAccountNetwork } from "./network";

function MidenBalanceSession() {
  const wallet = useMidenFiWallet();
  const store = useBalanceStore();
  const environment = useBridgeEnvironment();
  useEffect(() => {
    let matches = false;
    try { if (wallet.address) { assertMidenAccountNetwork(wallet.address, environment); matches = true; } } catch { /* wrong wallet network */ }
    store.setMidenSession(matches && wallet.connected && wallet.address ? {
      account: wallet.address,
      network: midenNetworks[environment].network,
      requestAssets: wallet.requestAssets,
    } : null);
  }, [store, wallet.connected, wallet.address, wallet.requestAssets, environment]);
  useEffect(() => () => store.setMidenSession(null), [store]);
  return null;
}

// Lets the wallet button force a full adapter remount to recover from a stuck
// connection (timeout / forget). Kept as context so the provider can live at
// the app root — persisting the connection across route navigations — while the
// reset trigger still comes from the button.
const ResetMidenProviderContext = createContext<() => void>(() => {});

export function useResetMidenProvider() {
  return useContext(ResetMidenProviderContext);
}

/**
 * App-root MidenFi wallet provider. Mounted once (via the client Providers
 * wrapper, ssr:false) so the connection survives navigation between the bridge
 * form and the activity detail pages instead of disconnecting on every route
 * change.
 *
 * `autoConnect` is intentionally OFF: with it on, the adapter fires a connect
 * attempt on every page load, so the button sits in a "Connecting" state (and
 * gets stuck there if the restore never resolves) before the user has done
 * anything. Connecting should be explicit — the button reads "Connect wallet"
 * until clicked, then goes to "Connecting" with the wallet popup. The root-level
 * mount still keeps the connection alive across in-app navigation.
 */
export function MidenWalletProvider({ children }: { children: ReactNode }) {
  const [providerKey, setProviderKey] = useState(0);
  const environment = useBridgeEnvironment();

  return (
    <ResetMidenProviderContext.Provider
      value={() => setProviderKey((key) => key + 1)}
    >
      <MidenFiSignerProvider
        key={providerKey}
        appName="Miden Bridge"
        // 0.17's adapter forwards this string unchanged to wallet.connect.
        // Bread supports "mainnet"; its published enum has not caught up yet.
        // Network-bearing addresses are independently checked before signing.
        network={environment === "testnet" ? WalletAdapterNetwork.Testnet : "mainnet" as WalletAdapterNetwork}
        // Request balance access in Bread's connection approval. Once granted,
        // asset reads need no additional prompt; notes and storage are excluded.
        privateDataPermission={PrivateDataPermission.Auto}
        allowedPrivateData={AllowedPrivateData.Assets}
        localStorageKey={environment === "testnet" ? "miden-bridge-wallet" : "miden-bridge-wallet.mainnet"}
      >
        {process.env.NEXT_PUBLIC_E2E_TEST !== "true" || environment === "mainnet" ? <MidenBalanceSession /> : null}
        {children}
      </MidenFiSignerProvider>
    </ResetMidenProviderContext.Provider>
  );
}
