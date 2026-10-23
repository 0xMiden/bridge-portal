import { midenNetworks, type BridgeEnvironment } from "./environment";
import type { EvmNetwork } from "../bridge/core/assets";
import type { z } from "zod";
import { bridgeConfigSchema } from "./wallet-config/schema";
import testnet from "./wallet-config/testnet.json";
import mainnet from "./wallet-config/mainnet.json";

export type BridgeConfig = z.infer<typeof bridgeConfigSchema>;

// The browser and server use the same release configuration. Historical
// transfers carry their own recovery context, independently of these files.
const current: Record<BridgeEnvironment, BridgeConfig> = {
  testnet: bridgeConfigSchema.parse(testnet),
  mainnet: bridgeConfigSchema.parse(mainnet),
};
export function currentBridgeConfig(environment: BridgeEnvironment): BridgeConfig {
  return current[environment];
}
export function configMidenNetwork(recovery: BridgeConfig = currentBridgeConfig("testnet")) {
  return midenNetworks[recovery.environment];
}
export function assertConfigNetwork(recovery: BridgeConfig, network: EvmNetwork) {
  if (!recovery.document.supportedEvmChains[network]) throw new Error("Network does not belong to this configuration.");
}

/** Stable comparison across JSON transport and key ordering. */
export function configKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(configKey).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${configKey(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
