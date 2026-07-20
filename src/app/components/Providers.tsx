"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { AppKitProvider } from "./AppKitProvider";
import { RejectionGuard } from "./RejectionGuard";
import { ThemeProvider } from "./ThemeProvider";

// E2E-only: auto-connect the headless test wallet. ssr:false + flag-gated so it
// never enters normal builds.
const E2EAutoConnect =
  process.env.NEXT_PUBLIC_E2E_TEST === "true"
    ? dynamic(
        () => import("./E2EAutoConnect").then((m) => m.E2EAutoConnect),
        { ssr: false },
      )
    : null;

// The MidenFi provider eager-loads the Miden SDK WASM, so it must stay out of
// the server render — load it client-only. Mounting it here (at the app root)
// keeps the wallet connected across route navigations.
const MidenWalletProvider = dynamic(
  () => import("./MidenWalletProvider").then((mod) => mod.MidenWalletProvider),
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
        <RejectionGuard />
        {E2EAutoConnect ? <E2EAutoConnect /> : null}
        <MidenWalletProvider>{children}</MidenWalletProvider>
      </AppKitProvider>
    </ThemeProvider>
  );
}
