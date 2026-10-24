import { arbitrum, base, polygon, mainnet, arbitrumSepolia, baseSepolia, sepolia } from "viem/chains";
import { arcMainnet, arcTestnet } from "./arc";
import type { EvmNetwork } from "../bridge/core/assets";
import type { Chain } from "viem";

export const evmNetworks = {
  ethereum: mainnet,
  arc: arcMainnet,
  base,
  arbitrum,
  polygon,
  sepolia,
  "arc-testnet": arcTestnet,
  "base-sepolia": baseSepolia,
  "arbitrum-sepolia": arbitrumSepolia,
} as const satisfies Record<EvmNetwork, Chain>;

export function isEvmNetwork(value: string): value is EvmNetwork {
  return Object.hasOwn(evmNetworks, value);
}
