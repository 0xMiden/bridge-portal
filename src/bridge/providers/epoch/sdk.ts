"use client";

import { EpochIntentSDK } from "@epoch-protocol/epoch-intents-sdk";
import { buildEpochReadOnlyWalletClient, buildEpochWalletClient, getEvmConnection } from "./client";
import { EPOCH_ALLOCATOR_URL } from "./config";

type SdkCache = { address: string; sdk: EpochIntentSDK };
let connectedCache: SdkCache | null = null;
let readOnlyCache: SdkCache | null = null;

/** Receive uses the connected Sepolia wallet to sign the collateral deposit. */
export async function getEpochSdk(): Promise<EpochIntentSDK | null> {
  const { address } = await getEvmConnection();
  if (!address) {
    connectedCache = null;
    return null;
  }
  if (connectedCache?.address === address) return connectedCache.sdk;
  const walletClient = await buildEpochWalletClient(address as `0x${string}`);
  const sdk = new EpochIntentSDK({ apiBaseUrl: EPOCH_ALLOCATOR_URL, walletClient });
  connectedCache = { address, sdk };
  return sdk;
}

/** Miden sends and status reads need a sponsor address, without an EVM signer. */
export async function getEpochReadOnlySdk(destinationAddress: `0x${string}`): Promise<EpochIntentSDK> {
  if (readOnlyCache?.address === destinationAddress) return readOnlyCache.sdk;
  const walletClient = buildEpochReadOnlyWalletClient(destinationAddress);
  const sdk = new EpochIntentSDK({ apiBaseUrl: EPOCH_ALLOCATOR_URL, walletClient });
  readOnlyCache = { address: destinationAddress, sdk };
  return sdk;
}
