import type { BridgeProvider, FlowMode } from "../core/models";
import type { Provider, ProviderDirection } from "../core/provider";
import { agglayer, agglayerDirection } from "./agglayer/provider";
import { epoch } from "./epoch/provider";
import { xreserve } from "./xreserve/provider";
import { manualHelperDirection } from "./xreserve/helper-provider";

/** Light configuration is synchronous; protocol dependencies load on demand. */
export const bridgeProviders: Record<BridgeProvider, Provider> = {
  xreserve,
  agglayer,
  epoch,
};

export function isBridgeProvider(value: unknown): value is BridgeProvider {
  return typeof value === "string" && Object.hasOwn(bridgeProviders, value);
}

export function directionFor(route: { provider: BridgeProvider; mode: FlowMode; environment?: string; source?: { network: string }; destination?: { network: string } | string; transport?: string; cctpHelper?: unknown }): ProviderDirection {
  if (route.provider === "xreserve" && (route.transport === "cctp-helper" || route.cctpHelper)) return manualHelperDirection;
  if (route.provider === "agglayer") {
    const mainnet = route.environment === "mainnet" || route.source?.network === "miden-mainnet" || (typeof route.destination === "object" && route.destination.network === "miden-mainnet");
    return agglayerDirection(route.mode, mainnet ? "mainnet" : "testnet");
  }
  return bridgeProviders[route.provider].directions[route.mode];
}
