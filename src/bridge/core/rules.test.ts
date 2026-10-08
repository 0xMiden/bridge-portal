import { defaultBridgeRoute } from "./routes";
import { MIDEN_USDC, SEPOLIA_USDC } from "./assets";
import { describe, expect, it } from "vitest";
import { isValidAmount, routeSwitchChangesAsset } from "./rules";

describe("isValidAmount (wallet-prompt floor)", () => {
  it("accepts a finite positive amount", () => {
    expect(isValidAmount("1")).toBe(true);
    expect(isValidAmount("0.0001")).toBe(true);
  });

  it("rejects empty, zero, negative, malformed, and non-finite amounts", () => {
    for (const bad of ["", "   ", "0", "0.0", "-1", "abc", "1.2.3", "1e999", "NaN", "Infinity"]) {
      expect(isValidAmount(bad)).toBe(false);
    }
  });
});

// The reset guard the form relies on: a route switch that changes the input
// asset must not silently preserve the numeric amount (an amount typed as USDC
// becoming the same number of ETH). routeSwitchChangesAsset is that decision.
describe("routeSwitchChangesAsset (amount/quote reset guard)", () => {
  it("flags a change switching Epoch (USDC) → Agglayer (ETH)", () => {
    expect(routeSwitchChangesAsset(defaultBridgeRoute("epoch", "receive")!, defaultBridgeRoute("agglayer", "receive")!)).toBe(true);
  });

  it("flags a change switching Agglayer (ETH) → Epoch (USDC)", () => {
    expect(routeSwitchChangesAsset(defaultBridgeRoute("agglayer", "receive")!, defaultBridgeRoute("epoch", "receive")!)).toBe(true);
  });

  it("does not flag re-selecting the same route", () => {
    expect(routeSwitchChangesAsset(defaultBridgeRoute("epoch", "receive")!, defaultBridgeRoute("epoch", "receive")!)).toBe(false);
    expect(routeSwitchChangesAsset(defaultBridgeRoute("agglayer", "receive")!, defaultBridgeRoute("agglayer", "receive")!)).toBe(false);
  });
});

// Symbols and provider names do not identify the asset that an amount belongs to.
it("resets for a different contract or network with the same symbol, but not a different provider of the same asset", () => {
  const route = defaultBridgeRoute("epoch", "receive")!;
  expect(routeSwitchChangesAsset(route, {
    ...route, source: { ...SEPOLIA_USDC, address: "0x1111111111111111111111111111111111111111" },
  })).toBe(true);
  expect(routeSwitchChangesAsset(route, { ...route, source: MIDEN_USDC })).toBe(true);
  expect(routeSwitchChangesAsset(route, { ...route, provider: "agglayer" })).toBe(false);
  expect(routeSwitchChangesAsset(route, {
    ...route, source: { ...SEPOLIA_USDC, address: SEPOLIA_USDC.address.toLowerCase() as `0x${string}` },
  })).toBe(false);
});
