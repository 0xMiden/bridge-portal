"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { AppKitProvider } from "../../wallets/evm/AppKitProvider";
import { RejectionGuard } from "../../wallets/RejectionGuard";
import { ThemeProvider } from "./ThemeProvider";
import { BalanceProvider } from "../../bridge/BalanceProvider";
import { NetworkProvider, useBridgeEnvironment } from "./NetworkProvider";

// E2E-only: auto-connect the headless test wallet. ssr:false + flag-gated so it
// never enters normal builds.
const E2EAutoConnect =
  process.env.NEXT_PUBLIC_E2E_TEST === "true"
    ? dynamic(
        () =>
          import("../../wallets/testing/E2EAutoConnect").then(
            (m) => m.E2EAutoConnect,
          ),
        { ssr: false },
      )
    : null;

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
        <NetworkProvider>
          <NetworkWalletProviders>{children}</NetworkWalletProviders>
        </NetworkProvider>
      </AppKitProvider>
    </ThemeProvider>
  );
}

function NetworkWalletProviders({ children }: { children: ReactNode }) {
  const environment = useBridgeEnvironment();
  return (
    <BalanceProvider key={environment}>
      <RejectionGuard />
      {E2EAutoConnect && environment === "testnet" ? <E2EAutoConnect /> : null}
      <MidenWalletProvider>{children}</MidenWalletProvider>
    </BalanceProvider>
  );
}
