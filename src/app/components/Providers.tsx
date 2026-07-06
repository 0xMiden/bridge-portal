"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { AppKitProvider } from "./AppKitProvider";

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
    <AppKitProvider cookies={cookies}>
      <MidenWalletProvider>{children}</MidenWalletProvider>
    </AppKitProvider>
  );
}
