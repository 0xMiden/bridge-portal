import type { BridgeProvider, FlowMode } from "../core/models";
import type { Provider } from "../core/provider";
import { agglayer } from "./agglayer/provider";
import { epoch } from "./epoch/provider";
import { xreserve } from "./xreserve/provider";

/** Light configuration is synchronous; protocol dependencies load on demand. */
export const bridgeProviders: Record<BridgeProvider, Provider> = {
  xreserve,
  agglayer,
  epoch,
};

export function isBridgeProvider(value: unknown): value is BridgeProvider {
  return typeof value === "string" && Object.hasOwn(bridgeProviders, value);
}

export function directionFor(route: { provider: BridgeProvider; mode: FlowMode }) {
  return bridgeProviders[route.provider].directions[route.mode];
}
