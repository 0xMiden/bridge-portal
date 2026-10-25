"use client";

import {
  AllowedPrivateData,
  PrivateDataPermission,
  WalletAdapterNetwork,
  WalletReadyState,
} from "@miden-sdk/miden-wallet-adapter-base";
import { MidenFiSignerProvider, useMidenFiWallet } from "@miden-sdk/miden-wallet-adapter-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useBalanceStore } from "../../bridge/BalanceProvider";
import { useBridgeEnvironment } from "../../app/components/NetworkProvider";
import { MidenWalletSession, midenWalletStorageKey } from "./miden-wallet-session";
import { MidenWalletContext } from "./useMidenWallet";

function MidenAdapterSession({ session }: { session: MidenWalletSession }) {
  const wallet = useMidenFiWallet();
  // Passive effects let the SDK attach its event listeners before a fast restore.
  useEffect(() => {
    session.updateWallet({ ...wallet,
      adapter: wallet.wallet?.adapter ?? null,
      logo: wallet.wallet?.adapter.icon,
      ready: wallet.wallet?.readyState === WalletReadyState.Installed || wallet.wallet?.readyState === WalletReadyState.Loadable,
    });
  }, [session, wallet]);
  useEffect(() => {
    if (!wallet.wallet && wallet.wallets.length) wallet.select(wallet.wallets[0].adapter.name);
  }, [wallet]);
  return null;
}

/** Loaded client-only at the app root; session lifetime is independent of routes. */
export function MidenWalletProvider({ children }: { children: ReactNode }) {
  const [providerKey, setProviderKey] = useState(0);
  const environment = useBridgeEnvironment();
  const balances = useBalanceStore();
  const [session] = useState(() => new MidenWalletSession(environment, balances, () => setProviderKey(key => key + 1)));
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Strict Mode replays effects in one commit; only a real root unmount
      // should cancel the shared connection attempt and its deadline.
      queueMicrotask(() => { if (!mounted.current) session.dispose(); });
    };
  }, [session]);

  return (
    <MidenWalletContext.Provider value={session}>
      <MidenFiSignerProvider
        key={providerKey}
        appName="Miden Bridge"
        // Bread supports mainnet; the published adapter enum has not caught up.
        network={environment === "testnet" ? WalletAdapterNetwork.Testnet : "mainnet" as WalletAdapterNetwork}
        // The session owns bounded restore attempts; SDK auto-connect stays off.
        autoConnect={false}
        privateDataPermission={PrivateDataPermission.Auto}
        allowedPrivateData={AllowedPrivateData.Assets}
        localStorageKey={midenWalletStorageKey(environment)}
      >
        <MidenAdapterSession session={session} />
      </MidenFiSignerProvider>
      {/* Reset only the adapter, preserving the form and other session consumers. */}
      {children}
    </MidenWalletContext.Provider>
  );
}
