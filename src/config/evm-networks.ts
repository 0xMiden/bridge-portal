import { cctpEvmChains } from "./cctp-evm-chains.ts";
import { arcMainnet, arcTestnet } from "./arc.ts";
import type { EvmNetwork } from "../bridge/core/assets";
import type { Chain } from "viem";

type EvmChain = Chain & { blockExplorers: { default: { name: string; url: string } } };
type EvmNetworkChains = { [Network in EvmNetwork]: Network extends "hyperevm-testnet" ? Chain : EvmChain };
export const evmNetworks: EvmNetworkChains = { ...cctpEvmChains, arc: arcMainnet, "arc-testnet": arcTestnet };

export function isEvmNetwork(value: string): value is EvmNetwork {
  return Object.hasOwn(evmNetworks, value);
}
