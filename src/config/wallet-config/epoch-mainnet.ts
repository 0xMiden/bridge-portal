import type { z } from "zod";
import type { bridgeConfigSchema } from "./schema";

// Portal rollout, independent of the pinned upstream fastBridge flag.
// USDCx, native ETH/POL and Robinhood USDG pairs quoted in both directions
// on 2026-10-30. Miden faucets and precision come from the pinned deployment.
export const EPOCH_MAINNET_ALLOCATOR_URL = "https://mainnet-api.epochprotocol.xyz";
const native = "0x0000000000000000000000000000000000000000";
const chains = {
  ethereum: { chainId: 1, tokens: { USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", ETH: native } },
  base: { chainId: 8453, tokens: { USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", ETH: native } },
  arbitrum: { chainId: 42161, tokens: { USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", ETH: native } },
  polygon: { chainId: 137, tokens: { USDC: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", POL: native } },
  robinhood: { chainId: 4663, tokens: { ETH: native, USDG: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" } },
} as const;

/** Preserve upstream snapshots; receipts save this effective deployment. */
export function withPortalEpochRoutes(pinned: z.infer<typeof bridgeConfigSchema>) {
  if (pinned.environment !== "mainnet") return pinned;
  const config = structuredClone(pinned);
  const doc = config.document;
  doc.features.fastBridge = true;
  doc["bridge-providers"].epoch = {
    allocatorUrl: EPOCH_MAINNET_ALLOCATOR_URL,
    outputs: { USDCx: { faucetId: config.derived.usdcxFaucetId }, ETH: { faucetId: config.derived.eth.faucetId } },
  };
  for (const symbol of ["POL", "USDG"]) {
    const token = config.derived.agglayerTokens?.find(token => token.symbol === symbol);
    if (!token) throw new Error(`Missing verified Epoch ${symbol} faucet`);
    doc["bridge-providers"].epoch.outputs![symbol] = { faucetId: token.faucetId };
  }
  for (const [network, { chainId, tokens }] of Object.entries(chains)) {
    const slug = network as keyof typeof chains;
    doc.supportedEvmChains[slug] = {
      chainId,
      bridges: {
        ...doc.supportedEvmChains[slug]?.bridges,
        epoch: {
          depositEnabled: true, withdrawalEnabled: true,
          tokens: Object.fromEntries(Object.entries(tokens).map(([symbol, contractAddress]) => [symbol, {
            contractAddress, outputs: [symbol === "USDC" ? "USDCx" : symbol],
          }])),
        },
      },
    };
  }
  return config;
}
