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

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export const metadata = {
  name: "Miden Bridge",
  description: "Miden testnet bridge UI",
  url: appUrl,
  icons: [`${appUrl}/favicon.ico`],
};
