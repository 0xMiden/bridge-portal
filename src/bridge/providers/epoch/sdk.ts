"use client";
import type { BridgeConfig } from "../../../config/bridge-config";

import { EpochIntentSDK } from "@epoch-protocol/epoch-intents-sdk";
import { buildEpochReadOnlyWalletClient, buildEpochWalletClient, getEvmConnection } from "./client";
import { epochAllocatorUrl } from "./config";

type SdkCache = { key: string; sdk: EpochIntentSDK };
let connectedCache: SdkCache | null = null;
let readOnlyCache: SdkCache | null = null;

/** Receive uses the connected Sepolia wallet to sign the collateral deposit. */
export async function getEpochSdk(recovery?: BridgeConfig): Promise<EpochIntentSDK | null> {
  const { address } = await getEvmConnection();
  if (!address) {
    connectedCache = null;
    return null;
  }
  const apiBaseUrl = epochAllocatorUrl(recovery);
  const key = `${apiBaseUrl}:${address.toLowerCase()}`;
  if (connectedCache?.key === key) return connectedCache.sdk;
  const walletClient = await buildEpochWalletClient(address as `0x${string}`);
  const sdk = new EpochIntentSDK({ apiBaseUrl, walletClient });
  connectedCache = { key, sdk };
  return sdk;
}

/** Miden sends and status reads need a sponsor address, without an EVM signer. */
export async function getEpochReadOnlySdk(destinationAddress: `0x${string}`, recovery?: BridgeConfig): Promise<EpochIntentSDK> {
  const apiBaseUrl = epochAllocatorUrl(recovery);
  const key = `${apiBaseUrl}:${destinationAddress.toLowerCase()}`;
  if (readOnlyCache?.key === key) return readOnlyCache.sdk;
  const walletClient = buildEpochReadOnlyWalletClient(destinationAddress);
  const sdk = new EpochIntentSDK({ apiBaseUrl, walletClient });
  readOnlyCache = { key, sdk };
  return sdk;
}
