"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { AppKitProvider } from "../../wallets/evm/AppKitProvider";
import { RejectionGuard } from "../../wallets/RejectionGuard";
import { ThemeProvider } from "./ThemeProvider";
import { BalanceProvider } from "../../bridge/BalanceProvider";
import { ActivityProvider } from "./ActivityProvider";
import { NetworkProvider, useBridgeEnvironment } from "./NetworkProvider";

// The MidenFi provider eager-loads the Miden SDK WASM, so it must stay out of
// the server render — load it client-only. Mounting it here (at the app root)
// keeps the wallet connected across route navigations.
const MidenWalletProvider = dynamic(
  () =>
    import("../../wallets/miden/MidenWalletProvider").then(
      (mod) => mod.MidenWalletProvider,
    ),
  { ssr: false },
);

export function Providers({
  children,
  cookies,
}: {
  children: ReactNode;
  cookies: string | null;
}) {
  return (
    <ThemeProvider>
      <AppKitProvider cookies={cookies}>
        <ActivityProvider>
          <NetworkProvider>
            <NetworkWalletProviders>{children}</NetworkWalletProviders>
          </NetworkProvider>
        </ActivityProvider>
      </AppKitProvider>
    </ThemeProvider>
  );
}

function NetworkWalletProviders({ children }: { children: ReactNode }) {
  const environment = useBridgeEnvironment();
  return (
    <BalanceProvider key={environment}>
      <RejectionGuard />
      <MidenWalletProvider>{children}</MidenWalletProvider>
    </BalanceProvider>
  );
}
