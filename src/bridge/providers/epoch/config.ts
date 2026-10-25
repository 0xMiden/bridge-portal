import { currentBridgeConfig, type BridgeConfig } from "../../../config/bridge-config";
/**
 * Epoch Protocol integration config.
 *
 * Ported from miden-wallet/src/lib/epoch/config.ts and adapted for this app.
 * Epoch handles cross-chain intents between the user's EVM wallet (connected
 * here via AppKit / wagmi) and the Miden chain. This app is the dApp / intent
 * submitter; the allocator is hosted by Epoch.
 */

export function epochAllocatorUrl(deployment: BridgeConfig = currentBridgeConfig("testnet")) {
  const provider = deployment.document["bridge-providers"].epoch;
  if (!provider) throw new Error("Epoch is unavailable on this network.");
  // The legacy override belongs to testnet; never route Cedar collateral to it.
  return deployment.environment === "testnet"
    ? process.env.NEXT_PUBLIC_EPOCH_ALLOCATOR_URL ?? provider.allocatorUrl
    : provider.allocatorUrl;
}

/**
 * Virtual chain id used by the SDK when an intent's origin / destination
 * is the Miden chain. The walletClient's `chain.id` must be temporarily set
 * to this value when calling solveIntent for a Miden→EVM flow. See:
 * https://docs.epochprotocol.xyz/epoch-miden-integration/integration-guide
 */
export const MIDEN_DESTINATION_CHAIN_ID = 999999999;
