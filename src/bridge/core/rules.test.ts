import { describe, expect, it } from "vitest";
import { isValidAmount, routeAsset, routeSwitchChangesAsset } from "./rules";

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

describe("routeAsset (route input token)", () => {
  it("moves USDC on Epoch, ETH on Agglayer", () => {
    expect(routeAsset("epoch")).toBe("USDC");
    expect(routeAsset("agglayer")).toBe("ETH");
  });
});

// The reset guard the form relies on: a route switch that changes the input
// asset must not silently preserve the numeric amount (an amount typed as USDC
// becoming the same number of ETH). routeSwitchChangesAsset is that decision.
describe("routeSwitchChangesAsset (amount/quote reset guard)", () => {
  it("flags a change switching Epoch (USDC) → Agglayer (ETH)", () => {
    expect(routeSwitchChangesAsset("epoch", "agglayer")).toBe(true);
  });

  it("flags a change switching Agglayer (ETH) → Epoch (USDC)", () => {
    expect(routeSwitchChangesAsset("agglayer", "epoch")).toBe(true);
  });

  it("does not flag re-selecting the same route", () => {
    expect(routeSwitchChangesAsset("epoch", "epoch")).toBe(false);
    expect(routeSwitchChangesAsset("agglayer", "agglayer")).toBe(false);
  });
});
