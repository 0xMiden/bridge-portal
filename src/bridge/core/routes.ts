import { CIRCLE_SEPOLIA_USDC, BASE_SEPOLIA_USDC, ARBITRUM_SEPOLIA_USDC, ARC_USDC, MIDEN_USDCX, MIDEN_ETH, MIDEN_USDC, SEPOLIA_ETH, SEPOLIA_USDC, EPOCH_MIDEN_USDC, EPOCH_MIDEN_DAI, EPOCH_SEPOLIA_DAI, EPOCH_MIDEN_USDT, EPOCH_SEPOLIA_USDT, EPOCH_MIDEN_WBTC, EPOCH_SEPOLIA_WBTC, sameAsset, type BridgeAsset } from "./assets";
import type { BridgeActivity, BridgeProvider, FlowMode } from "./models";
import { currentBridgeConfig, type BridgeConfig } from "../../config/bridge-config";
import type { BridgeEnvironment } from "../../config/environment";
import type { EvmNetwork, MidenAsset } from "./assets";

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

// Stable testnet route names and portal-owned Epoch test assets.
const testnetRouteTemplates: readonly Omit<BridgeRoute, "recovery">[] = [
  { id: "epoch-usdc-to-miden", provider: "epoch", mode: "receive", source: SEPOLIA_USDC, destination: MIDEN_USDC, disabled: true },
  { id: "epoch-usdc-to-sepolia", provider: "epoch", mode: "send", source: MIDEN_USDC, destination: SEPOLIA_USDC, disabled: true },
  { id: "epoch-test-usdc-to-miden", provider: "epoch", mode: "receive", source: SEPOLIA_USDC, destination: EPOCH_MIDEN_USDC },
  { id: "epoch-test-usdc-to-sepolia", provider: "epoch", mode: "send", source: EPOCH_MIDEN_USDC, destination: SEPOLIA_USDC },
  { id: "epoch-dai-to-miden", provider: "epoch", mode: "receive", source: EPOCH_SEPOLIA_DAI, destination: EPOCH_MIDEN_DAI },
  { id: "epoch-dai-to-sepolia", provider: "epoch", mode: "send", source: EPOCH_MIDEN_DAI, destination: EPOCH_SEPOLIA_DAI },
  { id: "epoch-usdt-to-miden", provider: "epoch", mode: "receive", source: EPOCH_SEPOLIA_USDT, destination: EPOCH_MIDEN_USDT },
  { id: "epoch-usdt-to-sepolia", provider: "epoch", mode: "send", source: EPOCH_MIDEN_USDT, destination: EPOCH_SEPOLIA_USDT },
  { id: "epoch-wbtc-to-miden", provider: "epoch", mode: "receive", source: EPOCH_SEPOLIA_WBTC, destination: EPOCH_MIDEN_WBTC },
  { id: "epoch-wbtc-to-sepolia", provider: "epoch", mode: "send", source: EPOCH_MIDEN_WBTC, destination: EPOCH_SEPOLIA_WBTC },
  // Only this direction quotes. Epoch pays its mock USDC, not Circle USDC.
  // WETH is omitted entirely: its current faucet returned no quotes.
  { id: "epoch-usdcx-to-sepolia", provider: "epoch", mode: "send", source: MIDEN_USDCX, destination: SEPOLIA_USDC },
  { id: "agglayer-eth-to-miden", provider: "agglayer", mode: "receive", source: SEPOLIA_ETH, destination: MIDEN_ETH },
  { id: "agglayer-eth-to-sepolia", provider: "agglayer", mode: "send", source: MIDEN_ETH, destination: SEPOLIA_ETH },
  { id: "xreserve-usdc-to-arc", provider: "xreserve", mode: "send", source: MIDEN_USDCX, destination: ARC_USDC },
  { id: "xreserve-usdc-to-sepolia", provider: "xreserve", mode: "send", source: MIDEN_USDCX, destination: CIRCLE_SEPOLIA_USDC },
  { id: "xreserve-usdc-to-base", provider: "xreserve", mode: "send", source: MIDEN_USDCX, destination: BASE_SEPOLIA_USDC },
  { id: "xreserve-usdc-to-arbitrum", provider: "xreserve", mode: "send", source: MIDEN_USDCX, destination: ARBITRUM_SEPOLIA_USDC },
  { id: "xreserve-usdc-to-miden", provider: "xreserve", mode: "receive", source: ARC_USDC, destination: MIDEN_USDCX },
  { id: "xreserve-sepolia-usdc-to-miden", provider: "xreserve", mode: "receive", source: CIRCLE_SEPOLIA_USDC, destination: MIDEN_USDCX },
  { id: "xreserve-base-usdc-to-miden", provider: "xreserve", mode: "receive", source: BASE_SEPOLIA_USDC, destination: MIDEN_USDCX },
  { id: "xreserve-arbitrum-usdc-to-miden", provider: "xreserve", mode: "receive", source: ARBITRUM_SEPOLIA_USDC, destination: MIDEN_USDCX },
];

function configuredRoutes(deployment: BridgeConfig): BridgeRoute[] {
  const { environment, document, derived } = deployment;
  const midenNetwork = environment === "mainnet" ? "miden-mainnet" : "miden-testnet";
  const routes: BridgeRoute[] = [];
  const add = (provider: BridgeProvider, evm: BridgeAsset, miden: MidenAsset, deposit: boolean, withdrawal: boolean) => {
    for (const mode of ["receive", "send"] as const) routes.push({
      id: `${environment}:${provider}:${evm.network}:${mode}`,
      recovery: deployment, provider, mode,
      source: mode === "receive" ? evm : miden,
      destination: mode === "receive" ? miden : evm,
      disabled: !(mode === "receive" ? deposit : withdrawal),
    });
  };
  for (const [slug, chain] of Object.entries(document.supportedEvmChains)) {
    const network = slug as EvmNetwork;
    const { usdcx, agglayer } = chain.bridges;
    if (usdcx?.tokens?.USDC) add("xreserve",
      { network, kind: "erc20", symbol: "USDC", name: "Circle USDC", decimals: 6, address: usdcx.tokens.USDC.contractAddress },
      { network: midenNetwork, kind: "miden", symbol: "USDCx", decimals: 6, faucetId: derived.usdcxFaucetId },
      usdcx.depositEnabled && document.features.bridgeIn !== false, usdcx.withdrawalEnabled && document.features.bridgeOut !== false);
    if (agglayer) add("agglayer",
      { network, kind: "native", symbol: "ETH", decimals: 18 },
      { network: midenNetwork, kind: "miden", symbol: "ETH", ...derived.eth },
      agglayer.depositEnabled && document.features.bridgeIn !== false,
      agglayer.withdrawalEnabled && document.features.bridgeOut !== false);
    if (agglayer && environment === "mainnet" && network === "ethereum") {
      for (const token of derived.agglayerTokens ?? []) routes.push({
        id: `${environment}:agglayer:${network}:${token.address.toLowerCase()}:receive`,
        recovery: deployment, provider: "agglayer", mode: "receive",
        source: { network, kind: "erc20", symbol: token.symbol, name: token.name, address: token.address, decimals: token.decimals },
        destination: { network: midenNetwork, kind: "miden", symbol: token.symbol, name: token.name, faucetId: token.faucetId, decimals: token.midenDecimals },
        disabled: !agglayer.depositEnabled || document.features.bridgeIn === false,
      });
    }
  }
  // Preserve the portal's additional verified Epoch test tokens. Their addresses
  // are distinct from Circle USDC; wallet-config owns provider availability.
  if (environment === "testnet") {
    const epoch = document.supportedEvmChains.sepolia?.bridges.epoch;
    const usdc = epoch?.tokens?.USDC;
    const output = usdc?.outputs?.[0];
    const faucetId = output ? document["bridge-providers"].epoch?.outputs?.[output]?.faucetId : undefined;
    const asset = (value: BridgeAsset): BridgeAsset => {
      if (value.kind === "erc20" && value.symbol === "USDC" && usdc) return { ...value, address: usdc.contractAddress };
      if (value.kind === "miden" && value.symbol === "USDC" && faucetId && value.faucetId === EPOCH_MIDEN_USDC.faucetId) return { ...value, faucetId };
      if (value.kind === "miden" && value.symbol === "USDCx") return { ...value, faucetId: derived.usdcxFaucetId };
      return value;
    };
    routes.push(...testnetRouteTemplates.filter(route => route.provider === "epoch").map(route => ({
      ...route, source: asset(route.source), destination: asset(route.destination), recovery: deployment,
      disabled: route.disabled || document.features.fastBridge === false || !epoch ||
        !(route.mode === "receive" ? epoch.depositEnabled : epoch.withdrawalEnabled) ||
        document.features[route.mode === "receive" ? "bridgeIn" : "bridgeOut"] === false,
    })));
  }
  return routes;
}

function routesForConfig(config: BridgeConfig): readonly BridgeRoute[] {
  const configured = configuredRoutes(config);
  if (config.environment === "mainnet") return configured;
  return testnetRouteTemplates.flatMap(route => {
    const match = configured.find(candidate => candidate.provider === route.provider && candidate.mode === route.mode &&
      candidate.source.network === route.source.network && candidate.destination.network === route.destination.network &&
      (route.provider !== "epoch" || candidate.id === route.id));
    return match ? [{ ...match, id: route.id, disabled: route.disabled || match.disabled }] : [];
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
