import type { BridgeRoute } from "../../core/routes";
import { SEPOLIA_NETWORK } from "../../../config/sepolia";

/** EVM destination chain for the Epoch route (Sepolia). */
export const EPOCH_DESTINATION_CHAIN_ID = SEPOLIA_NETWORK.chainId;

function isBridgeableEvmTokenConfigured(address: string): boolean {
  return (
    /^0x[0-9a-fA-F]{40}$/.test(address) &&
    address !== "0x0000000000000000000000000000000000000000"
  );
}

/** Epoch currently connects a Sepolia ERC20 with a Miden faucet token. */
export function epochRouteAssets(route: BridgeRoute) {
  const miden = route.mode === "send" ? route.source : route.destination;
  const evm = route.mode === "send" ? route.destination : route.source;
  if (
    route.provider !== "epoch" || miden.kind !== "miden" || evm.kind !== "erc20" ||
    !isBridgeableEvmTokenConfigured(evm.address)
  ) {
    throw new Error("The Epoch route is not configured yet.");
  }
  return { miden, evm };
}
