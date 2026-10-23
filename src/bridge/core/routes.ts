import { sameAsset, type BridgeAsset } from "./assets";
import type { BridgeActivity, BridgeProvider, FlowMode } from "./models";
import { currentBridgeConfig, type BridgeConfig } from "../../config/bridge-config";
import type { BridgeEnvironment } from "../../config/environment";
import { tokenRegistry } from "../../config/token-registry";

export type BridgeRoute = {
  id: string;
  provider: BridgeProvider;
  mode: FlowMode;
  source: BridgeAsset;
  destination: BridgeAsset;
  /** Keep paused directions addressable for existing activity receipts. */
  disabled?: boolean;
  recovery: BridgeConfig;
};

function routesForConfig(config: BridgeConfig): readonly BridgeRoute[] {
  const { environment, document } = config;
  return tokenRegistry[environment].flatMap(connection => {
    const { provider, evm, miden } = connection;
    const bridge = document.supportedEvmChains[evm.network]?.bridges[provider === "xreserve" ? "usdcx" : provider];
    return (["receive", "send"] as const).flatMap(mode => {
      const id = connection.routes[mode];
      if (!id) return [];
      return [{
        id, provider, mode, recovery: config,
        source: mode === "receive" ? evm : miden,
        destination: mode === "receive" ? miden : evm,
        disabled: connection.disabled || !bridge ||
          !(mode === "receive" ? bridge.depositEnabled : bridge.withdrawalEnabled) ||
          document.features[mode === "receive" ? "bridgeIn" : "bridgeOut"] === false ||
          (provider === "epoch" && document.features.fastBridge === false),
      }];
    });
  });
}

// Release configuration is fixed for the page lifetime; derive routes once.
const networkRoutes = {
  testnet: routesForConfig(currentBridgeConfig("testnet")),
  mainnet: routesForConfig(currentBridgeConfig("mainnet")),
};
export const bridgeRoutes: readonly BridgeRoute[] = [...networkRoutes.testnet, ...networkRoutes.mainnet];

export function routeEnvironment(route: BridgeRoute): BridgeEnvironment {
  return route.source.network === "miden-mainnet" || route.destination.network === "miden-mainnet" ? "mainnet" : "testnet";
}

export function routesForEnvironment(environment: BridgeEnvironment) {
  return networkRoutes[environment];
}

export function findBridgeRoute(id: string): BridgeRoute | undefined {
  return bridgeRoutes.find((route) => route.id === id);
}

/** Resolve the existing provider/direction preferences and launch URL parameters. */
export function defaultBridgeRoute(provider: BridgeProvider, mode: FlowMode, environment: BridgeEnvironment = "testnet"): BridgeRoute | undefined {
  return routesForEnvironment(environment).find((route) => !route.disabled && route.provider === provider && route.mode === mode);
}

export function reverseBridgeRoute(route: BridgeRoute): BridgeRoute | undefined {
  return bridgeRoutes.find((candidate) => !candidate.disabled && candidate.provider === route.provider &&
    sameAsset(candidate.source, route.destination) && sameAsset(candidate.destination, route.source));
}

/** Receipts carry their original configuration independently of the current release. */
export function activityRoute(activity: BridgeActivity): BridgeRoute | undefined {
  const route = activity.routeSnapshot;
  return route?.recovery && route.provider === activity.provider && route.mode === activity.mode ? route : undefined;
}
