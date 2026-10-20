import { describe, expect, it } from "vitest";
import { CIRCLE_SEPOLIA_USDC, MIDEN_ETH, MIDEN_USDCX, SEPOLIA_USDC } from "../../bridge/core/assets";
import { bridgeRoutes, findBridgeRoute, type BridgeRoute } from "../../bridge/core/routes";
import { tokenChoices } from "./token-choices";

const circle = findBridgeRoute("xreserve-sepolia-usdc-to-miden")!;
const alternative: BridgeRoute = { ...circle, id: "another-usdc-route", provider: "agglayer" };

describe("token choices across compatible routes", () => {
  it.each(["source", "destination"] as const)("keeps %s choices on the selected chains and direction", (side) => {
    const arc = findBridgeRoute("xreserve-usdc-to-miden")!;
    const choices = tokenChoices(arc, side, bridgeRoutes);
    expect(choices.map(({ asset }) => asset.symbol)).toEqual([side === "source" ? "USDC" : "USDCx"]);
    expect(choices[0].route.id).toBe(arc.id);
  });

  it.each(["source", "destination"] as const)("lists an asset once and preserves the selected route on the %s side", (side) => {
    // A later route serves the same asset pair, including differently cased
    // contract metadata. Selecting that asset must not switch back to the first.
    const current: BridgeRoute = {
      ...alternative,
      source: { ...CIRCLE_SEPOLIA_USDC, address: CIRCLE_SEPOLIA_USDC.address.toLowerCase() as `0x${string}` },
    };
    const choices = tokenChoices(current, side, [circle, current]);
    expect(choices).toHaveLength(1);
    expect(choices[0].route.id).toBe("another-usdc-route");
  });

  it("keeps same-symbol tokens with different contracts or faucets separate", () => {
    const differentAssets: BridgeRoute = {
      ...circle, id: "different-usdc-assets", source: SEPOLIA_USDC,
      destination: { ...MIDEN_USDCX, faucetId: "0x1234" },
    };
    for (const side of ["source", "destination"] as const) {
      expect(tokenChoices(circle, side, [circle, alternative, differentAssets])).toHaveLength(2);
    }
  });

  it("keeps the opposite asset before preferring the previous provider for a new token", () => {
    const current = findBridgeRoute("agglayer-eth-to-miden")!;
    const keepsProvider: BridgeRoute = { ...alternative, destination: MIDEN_USDCX };
    const keepsOppositeAsset: BridgeRoute = { ...circle, destination: MIDEN_ETH };
    const choices = tokenChoices(current, "source", [keepsProvider, keepsOppositeAsset]);
    expect(choices).toHaveLength(1);
    expect(choices[0].route.id).toBe(circle.id);
  });
});
