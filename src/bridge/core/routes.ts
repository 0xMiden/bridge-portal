import { CIRCLE_SEPOLIA_USDC, BASE_SEPOLIA_USDC, ARBITRUM_SEPOLIA_USDC, ARC_USDC, MIDEN_USDCX, MIDEN_ETH, MIDEN_USDC, SEPOLIA_ETH, SEPOLIA_USDC, sameAsset, type BridgeAsset } from "./assets";
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
  { id: "epoch-usdc-to-miden", provider: "epoch", mode: "receive", source: SEPOLIA_USDC, destination: MIDEN_USDC },
  { id: "epoch-usdc-to-sepolia", provider: "epoch", mode: "send", source: MIDEN_USDC, destination: SEPOLIA_USDC },
  { id: "agglayer-eth-to-miden", provider: "agglayer", mode: "receive", source: SEPOLIA_ETH, destination: MIDEN_ETH },
  { id: "agglayer-eth-to-sepolia", provider: "agglayer", mode: "send", source: MIDEN_ETH, destination: SEPOLIA_ETH, disabled: true },
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
