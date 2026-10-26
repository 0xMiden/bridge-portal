import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { sepolia, baseSepolia, arbitrumSepolia, mainnet, base, arbitrum, polygon } from "@reown/appkit/networks";
import type { AppKitNetwork } from "@reown/appkit/networks";
import { arcTestnet, arcMainnet } from "../../config/arc";
import { evmReadTransport } from "../../bridge/evm/transport";
import { SITE_DESCRIPTION, SITE_NAME } from "../../config/site";

export const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID!;

export const networks: [AppKitNetwork, ...AppKitNetwork[]] = [sepolia, arcTestnet, baseSepolia, arbitrumSepolia, mainnet, arcMainnet, base, arbitrum, polygon];

export const wagmiAdapter = new WagmiAdapter({
  networks,
  projectId,
  ssr: true,
  transports: {
    [polygon.id]: evmReadTransport("polygon"),
    [mainnet.id]: evmReadTransport("ethereum"),
    [arcMainnet.id]: evmReadTransport("arc"),
    [base.id]: evmReadTransport("base"),
    [arbitrum.id]: evmReadTransport("arbitrum"),
    [sepolia.id]: evmReadTransport("sepolia"),
    [arcTestnet.id]: evmReadTransport("arc-testnet"),
    [baseSepolia.id]: evmReadTransport("base-sepolia"),
    [arbitrumSepolia.id]: evmReadTransport("arbitrum-sepolia"),
  },
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
