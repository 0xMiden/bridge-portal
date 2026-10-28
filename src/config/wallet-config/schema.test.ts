import { expect, it } from "vitest";
import { bridgeConfigSchema } from "./schema";
import testnet from "./testnet.json";
import { currentBridgeConfig } from "../bridge-config";

it.each([
  ["https://mainnet-api.epochprotocol.xyz", true],
  ["https://miden-smallocator.epochprotocol.xyz", true],
  ["https://testnet-dev.epochprotocol.xyz", false],
  ["https://mainnet-api.epochprotocol.xyz.evil.example", false],
])("validates the Epoch service root in saved mainnet recovery data: %s", (allocatorUrl, approved) => {
  const recovery = structuredClone(currentBridgeConfig("mainnet"));
  recovery.document["bridge-providers"].epoch!.allocatorUrl = allocatorUrl;
  expect(bridgeConfigSchema.safeParse(JSON.parse(JSON.stringify(recovery))).success).toBe(approved);
});

it.each(["Circle executor chain", "Epoch output reference", "Epoch output faucet"])(
  "rejects an unresolved %s before configuration can be used",
  missing => {
    const config = bridgeConfigSchema.parse(testnet);
    if (missing === "Circle executor chain") delete config.document.supportedEvmChains["arc-testnet"];
    if (missing === "Epoch output reference") config.document.supportedEvmChains.sepolia!.bridges.epoch!.tokens!.USDC.outputs = [];
    if (missing === "Epoch output faucet") config.document["bridge-providers"].epoch!.outputs = {};
    expect(() => bridgeConfigSchema.parse(config)).toThrow(/Unresolved (Circle executor|Epoch output)/);
  },
);
