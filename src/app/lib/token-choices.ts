import { assetKey, sameAsset, type BridgeAsset } from "../../bridge/core/assets";
import type { BridgeRoute } from "../../bridge/core/routes";

/** One choice per asset, with a compatible route resolved behind the selector. */
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
