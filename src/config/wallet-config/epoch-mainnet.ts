import type { z } from "zod";
import type { bridgeConfigSchema } from "./schema";

// Portal rollout, independent of the pinned upstream fastBridge flag.
// Deployment: 0xMiden/wallet-config#23; USDC pairs verified in both directions
// on 2026-10-24. Epoch's current mainnet API host was adopted on 2026-10-27.
export const EPOCH_MAINNET_ALLOCATOR_URL = "https://mainnet-api.epochprotocol.xyz";
const chains = {
  ethereum: { chainId: 1, address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
  base: { chainId: 8453, address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
  arbitrum: { chainId: 42161, address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" },
  polygon: { chainId: 137, address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359" },
} as const;

/** Preserve upstream snapshots; receipts save this effective deployment. */
export function withPortalEpochRoutes(pinned: z.infer<typeof bridgeConfigSchema>) {
  if (pinned.environment !== "mainnet") return pinned;
  const config = structuredClone(pinned);
  const doc = config.document;
  doc.features.fastBridge = true;
  doc["bridge-providers"].epoch = {
    allocatorUrl: EPOCH_MAINNET_ALLOCATOR_URL,
    outputs: { USDCx: { faucetId: config.derived.usdcxFaucetId } },
  };
  for (const [network, { chainId, address }] of Object.entries(chains)) {
    const slug = network as keyof typeof chains;
    doc.supportedEvmChains[slug] = {
      chainId,
      bridges: {
        ...doc.supportedEvmChains[slug]?.bridges,
        epoch: {
          depositEnabled: true, withdrawalEnabled: true,
          tokens: { USDC: { contractAddress: address, outputs: ["USDCx"] } },
        },
      },
    };
  }
  return config;
}
