import { describe, expect, it } from "vitest";

import { getSepoliaRpcUrl } from "./rpc";

describe("getSepoliaRpcUrl", () => {
  it("prefers the Agglayer Sepolia RPC endpoint", () => {
    expect(
      getSepoliaRpcUrl({
        AGGLAYER_SEPOLIA_RPC_URL: "https://primary.example",
        EVM_RPC_URL: "https://fallback.example",
      }),
    ).toBe("https://primary.example");
  });

  it("falls back to EVM_RPC_URL", () => {
    expect(getSepoliaRpcUrl({ EVM_RPC_URL: "https://fallback.example" })).toBe(
      "https://fallback.example",
    );
  });

  it("uses the public Sepolia endpoint when no override is configured", () => {
    expect(getSepoliaRpcUrl({})).toBe("https://ethereum-sepolia-rpc.publicnode.com");
  });
});
