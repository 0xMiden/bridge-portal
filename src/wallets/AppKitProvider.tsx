"use client";

import { createAppKit } from "@reown/appkit/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider, cookieToInitialState, type Config } from "wagmi";
import {
  metadata,
  networks,
  projectId,
  wagmiAdapter,
  bitcoinAdapter,
} from "./appkit-config";

// Must run once at module scope, not inside the component.
export const appKit = createAppKit({
  adapters: [wagmiAdapter, bitcoinAdapter],
  networks,
  projectId,
  metadata,
  defaultAccountTypes: { bip122: "payment" },
  features: { analytics: false },
});

export function AppKitProvider({
  children,
  cookies,
}: {
  children: ReactNode;
  cookies: string | null;
}) {
  const [queryClient] = useState(() => new QueryClient());
  const initialState = cookieToInitialState(
    wagmiAdapter.wagmiConfig as Config,
    cookies,
  );

  return (
    <WagmiProvider
      config={wagmiAdapter.wagmiConfig as Config}
      initialState={initialState}
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
