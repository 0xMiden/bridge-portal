import { CIRCLE_SEPOLIA_USDC, BASE_SEPOLIA_USDC, ARBITRUM_SEPOLIA_USDC, ARC_USDC, MIDEN_USDCX, MIDEN_ETH, MIDEN_USDC, SEPOLIA_ETH, SEPOLIA_USDC, EPOCH_MIDEN_USDC, EPOCH_MIDEN_DAI, EPOCH_SEPOLIA_DAI, EPOCH_MIDEN_USDT, EPOCH_SEPOLIA_USDT, EPOCH_MIDEN_WBTC, EPOCH_SEPOLIA_WBTC, sameAsset, type BridgeAsset } from "./assets";
import type { BridgeActivity, BridgeProvider, FlowMode } from "./models";

export type BridgeRoute = {
  id: string;
  provider: BridgeProvider;
  mode: FlowMode;
  source: BridgeAsset;
  destination: BridgeAsset;
  /** Keep paused directions addressable for existing activity receipts. */
  disabled?: boolean;
};

// Known testnet routes, including paused providers needed for activity tracking.
export const bridgeRoutes: readonly BridgeRoute[] = [
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

export function findBridgeRoute(id: string): BridgeRoute | undefined {
  return bridgeRoutes.find((route) => route.id === id);
}

/** Resolve the existing provider/direction preferences and launch URL parameters. */
export function defaultBridgeRoute(provider: BridgeProvider, mode: FlowMode): BridgeRoute | undefined {
  return bridgeRoutes.find((route) => !route.disabled && route.provider === provider && route.mode === mode);
}

export function reverseBridgeRoute(route: BridgeRoute): BridgeRoute | undefined {
  return bridgeRoutes.find((candidate) => !candidate.disabled && candidate.provider === route.provider &&
    sameAsset(candidate.source, route.destination) && sameAsset(candidate.destination, route.source));
}

/** Older saved rows have no route id; match their recorded token as well. */
export function activityRoute(activity: BridgeActivity): BridgeRoute | undefined {
  if (activity.routeId) return findBridgeRoute(activity.routeId);
  return bridgeRoutes.find((route) =>
    route.provider === activity.provider && route.mode === activity.mode &&
    route.source.symbol === activity.asset,
  );
}
