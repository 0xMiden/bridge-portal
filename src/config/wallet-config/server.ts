import { configKey, currentBridgeConfig, type BridgeConfig } from "../bridge-config";
import type { EvmNetwork } from "../../bridge/core/assets";

export class ConfigRequestError extends Error {}

/** New starts cannot select old contracts, edited destinations, or disabled routes. */
export function assertCurrentConfig(recovery: BridgeConfig, network: EvmNetwork, mode: "receive" | "send") {
  const config = currentBridgeConfig(recovery.environment);
  if (configKey(recovery) !== configKey(config)) throw new ConfigRequestError("Bridge configuration changed. Refresh the page and review the transfer.");
  const bridge = config.document.supportedEvmChains[network]?.bridges.usdcx;
  if (!bridge || !(mode === "receive" ? bridge.depositEnabled : bridge.withdrawalEnabled) ||
      config.document.features[mode === "receive" ? "bridgeIn" : "bridgeOut"] === false)
    throw new ConfigRequestError("This direction is unavailable. Refresh the page to choose another route.");
}
