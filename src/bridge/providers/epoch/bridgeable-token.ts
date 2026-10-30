import type { BridgeRoute } from "../../core/routes";
import { evmNetworks } from "../../../config/evm-networks";
import { zeroAddress } from "viem";

function isBridgeableEvmTokenConfigured(address: string): boolean {
  return (
    /^0x[0-9a-fA-F]{40}$/.test(address) &&
    address !== "0x0000000000000000000000000000000000000000"
  );
}

/** Native EVM assets use Epoch's zero-address token sentinel. */
export function epochRouteAssets(route: BridgeRoute) {
  const miden = route.mode === "send" ? route.source : route.destination;
  const evm = route.mode === "send" ? route.destination : route.source;
  if (
    route.disabled || route.provider !== "epoch" || miden.kind !== "miden" || evm.kind === "miden" ||
    (evm.kind === "erc20" && !isBridgeableEvmTokenConfigured(evm.address))
  ) {
    throw new Error("The Epoch route is not configured yet.");
  }
  return { miden, evm, chain: evmNetworks[evm.network], tokenAddress: evm.kind === "native" ? zeroAddress : evm.address };
}
