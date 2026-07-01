import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { sepolia } from "@reown/appkit/networks";
import type { AppKitNetwork } from "@reown/appkit/networks";

export const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID!;

export const networks: [AppKitNetwork, ...AppKitNetwork[]] = [sepolia];

export const wagmiAdapter = new WagmiAdapter({
  networks,
  projectId,
  ssr: true,
});

// Use the real page origin in the browser (where createAppKit consumes this),
// so the WalletConnect metadata.url matches the actual host on any deploy —
// no per-env config and no "metadata.url differs from page url" warning.
// Falls back to NEXT_PUBLIC_APP_URL during SSR (where window is undefined).
const appUrl =
  typeof window !== "undefined"
    ? window.location.origin
    : process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export const metadata = {
  name: "Miden Bridge",
  description: "Miden testnet bridge UI",
  url: appUrl,
  icons: [`${appUrl}/favicon.ico`],
};
