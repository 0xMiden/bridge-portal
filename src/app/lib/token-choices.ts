import { assetKey, sameAsset, type BridgeAsset } from "../../bridge/core/assets";
import type { BridgeRoute } from "../../bridge/core/routes";

/** Discover tokens for the selected chain pair, then resolve a route per asset. */
export function tokenChoices(
  current: BridgeRoute,
  side: "source" | "destination",
  routes: readonly BridgeRoute[],
) {
  const otherSide = side === "source" ? "destination" : "source";
  const choices = new Map<string, { asset: BridgeAsset; route: BridgeRoute }>();
  const preference = (route: BridgeRoute) => route.id === current.id ? 4
    : Number(sameAsset(route[otherSide], current[otherSide])) * 2
      + Number(route.provider === current.provider);

  for (const route of routes) {
    if (route.disabled || route.mode !== current.mode ||
      route.source.network !== current.source.network ||
      route.destination.network !== current.destination.network) continue;
    const asset = route[side];
    const key = assetKey(asset);
    const existing = choices.get(key);
    // Re-selecting an asset keeps the chosen route. For another asset, preserve
    // the opposite asset first, then the provider, when those remain compatible.
    if (!existing || preference(route) > preference(existing.route)) {
      choices.set(key, { asset, route });
    }
  }
  return [...choices.values()];
}
