import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { sepolia, baseSepolia, arbitrumSepolia } from "@reown/appkit/networks";
import type { AppKitNetwork } from "@reown/appkit/networks";
import { arcTestnet } from "../../config/arc";
import { evmReadTransport } from "../../bridge/evm/transport";
import { e2eEvmConnector } from "../testing/evm-connector";

export const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID!;

export const networks: [AppKitNetwork, ...AppKitNetwork[]] = [sepolia, arcTestnet, baseSepolia, arbitrumSepolia];

// In E2E mode, register a headless test-wallet connector that signs Sepolia txs
// with the test key (no MetaMask). The env check is inlined (not a helper call)
// so webpack's DefinePlugin folds it to a constant and dead-code-eliminates the
// connector — and its transitive e2e code — out of normal production bundles.
const e2eConnectors =
  process.env.NEXT_PUBLIC_E2E_TEST === "true" ? [e2eEvmConnector()] : [];

export const wagmiAdapter = new WagmiAdapter({
  networks,
  projectId,
  ssr: true,
  transports: {
    [sepolia.id]: evmReadTransport("sepolia"),
    [arcTestnet.id]: evmReadTransport("arc-testnet"),
    [baseSepolia.id]: evmReadTransport("base-sepolia"),
    [arbitrumSepolia.id]: evmReadTransport("arbitrum-sepolia"),
  },
  ...(e2eConnectors.length ? { connectors: e2eConnectors } : {}),
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
