import { sameAsset, type BridgeAsset } from "./assets";
import type { BridgeActivity, BridgeProvider, FlowMode } from "./models";
import { currentBridgeConfig, type BridgeConfig } from "../../config/bridge-config";
import type { BridgeEnvironment } from "../../config/environment";
import { tokenRegistry } from "../../config/token-registry";
import { assertHelperConfig, helperDeployments, type HelperDeployment } from "../../config/cctp-helper";

export type BridgeRoute = {
  id: string;
  provider: BridgeProvider;
  mode: FlowMode;
  source: BridgeAsset;
  destination: BridgeAsset;
  /** Keep paused directions addressable for existing activity receipts. */
  disabled?: boolean;
  recovery: BridgeConfig;
  transport?: "cctp-helper";
  execution?: "manual";
  helperDeployment?: HelperDeployment;
};

function routesForConfig(config: BridgeConfig): readonly BridgeRoute[] {
  const { environment, document } = config;
  const legacy: BridgeRoute[] = tokenRegistry[environment].flatMap(connection => {
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
  const deployments = helperDeployments.filter(entry => entry.environment === environment);
  const destination = legacy.find(route => route.provider === "xreserve" && route.mode === "receive")?.destination;
  if (!destination) return legacy;
  const manual = (deployments.length ? deployments : [undefined]).map(deployment => {
    if (deployment) assertHelperConfig(deployment, config);
    return { id: `${environment}:cctp-helper-solana-manual${deployment ? `:${deployment.deploymentId}` : ""}`, provider: "xreserve", mode: "receive",
      transport: "cctp-helper", execution: "manual", helperDeployment: deployment, recovery: config,
      disabled: !deployment?.enabled || document.features.bridgeIn === false,
      source: { kind: "spl", network: environment === "mainnet" ? "solana-mainnet" : "solana-devnet", symbol: "USDC", decimals: 6,
        name: "Circle USDC", logo: "/asset-logos/usdc.svg", mint: deployment?.source.mint ?? (environment === "mainnet" ? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" : "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU") }, destination,
    } satisfies BridgeRoute;
  });
  return [...legacy, ...manual];
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
