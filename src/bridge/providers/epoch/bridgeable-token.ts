import type { BridgeRoute } from "../../core/routes";
import { evmNetworks } from "../../../config/evm-networks";

function isBridgeableEvmTokenConfigured(address: string): boolean {
  return (
    /^0x[0-9a-fA-F]{40}$/.test(address) &&
    address !== "0x0000000000000000000000000000000000000000"
  );
}

/** Epoch connects an EVM ERC20 with a Miden faucet token. */
export function epochRouteAssets(route: BridgeRoute) {
  const miden = route.mode === "send" ? route.source : route.destination;
  const evm = route.mode === "send" ? route.destination : route.source;
  if (
    route.disabled || route.provider !== "epoch" || miden.kind !== "miden" || evm.kind !== "erc20" ||
    !isBridgeableEvmTokenConfigured(evm.address)
  ) {
    throw new Error("The Epoch route is not configured yet.");
  }
  return { miden, evm, chain: evmNetworks[evm.network] };
}
