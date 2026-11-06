import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import type { AppKitNetwork } from "@reown/appkit/networks";
import { evmNetworks } from "../../config/evm-networks";
import { evmReadTransport } from "../../bridge/evm/transport";
import { SITE_DESCRIPTION, SITE_NAME } from "../../config/site";

export const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID!;

const preferred = ["arc-testnet", "base-sepolia", "arbitrum-sepolia", "ethereum", "arc", "base", "arbitrum", "polygon"] as const;
const additions = Object.entries(evmNetworks).filter(([name]) => !preferred.some(existing => existing === name)).map(([, chain]) => chain);
export const networks: [AppKitNetwork, ...AppKitNetwork[]] = [evmNetworks.sepolia, ...preferred.map(name => evmNetworks[name]), ...additions.filter(chain => chain.id !== evmNetworks.sepolia.id)];
export const wagmiAdapter = new WagmiAdapter({ networks, projectId, ssr: true,
  transports: Object.fromEntries(Object.entries(evmNetworks).map(([name, chain]) => [chain.id, evmReadTransport(name as keyof typeof evmNetworks)])),
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
  name: SITE_NAME,
  description: SITE_DESCRIPTION,
  url: appUrl,
  icons: [`${appUrl}/wallet-icon.png`],
};
