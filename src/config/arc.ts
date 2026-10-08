import { defineChain } from "viem";

// Arc network reference and Philipp's frontend guide (2026-09-22), updated by
// the 2026-09-28 deployment announcement in #wg-usdcx. Circle domains are NOT
// EVM chain IDs. Native gas USDC has 18 decimals; the ERC-20 interface has 6.
export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        process.env.NEXT_PUBLIC_ARC_RPC_URL || "https://rpc.testnet.arc.io",
      ],
    },
  },
  blockExplorers: {
    default: { name: "Arc explorer", url: "https://explorer.testnet.arc.io" },
  },
  testnet: true,
});
