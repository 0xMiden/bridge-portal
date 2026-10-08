"use client";

import {
  AllowedPrivateData,
  PrivateDataPermission,
  WalletAdapterNetwork,
} from "@miden-sdk/miden-wallet-adapter-base";
import { MidenFiSignerProvider, useMidenFiWallet } from "@miden-sdk/miden-wallet-adapter-react";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useBalanceStore } from "../../bridge/BalanceProvider";

function MidenBalanceSession() {
  const wallet = useMidenFiWallet();
  const store = useBalanceStore();
  useEffect(() => {
    store.setMidenSession(wallet.connected && wallet.address ? {
      account: wallet.address,
      network: "miden-testnet",
      requestAssets: wallet.requestAssets,
    } : null);
  }, [store, wallet.connected, wallet.address, wallet.requestAssets]);
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

  return (
    <ResetMidenProviderContext.Provider
      value={() => setProviderKey((key) => key + 1)}
    >
      <MidenFiSignerProvider
        key={providerKey}
        appName="Miden Bridge"
        network={WalletAdapterNetwork.Testnet}
        privateDataPermission={PrivateDataPermission.UponRequest}
        allowedPrivateData={AllowedPrivateData.None}
        localStorageKey="miden-bridge-wallet"
      >
        {process.env.NEXT_PUBLIC_E2E_TEST !== "true" ? <MidenBalanceSession /> : null}
        {children}
      </MidenFiSignerProvider>
    </ResetMidenProviderContext.Provider>
  );
}
