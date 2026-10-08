import { arbitrumSepolia, baseSepolia, sepolia } from "viem/chains";
import { arcTestnet } from "./arc";
import type { EvmNetwork } from "../bridge/core/assets";
import type { Chain } from "viem";

export const evmNetworks = {
  sepolia,
  "arc-testnet": arcTestnet,
  "base-sepolia": baseSepolia,
  "arbitrum-sepolia": arbitrumSepolia,
} as const satisfies Record<EvmNetwork, Chain>;

export function isEvmNetwork(value: string): value is EvmNetwork {
  return Object.hasOwn(evmNetworks, value);
}
