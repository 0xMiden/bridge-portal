"use client";

import { EpochIntentSDK } from "@epoch-protocol/epoch-intents-sdk";
import { sepolia } from "viem/chains";

import { buildEpochReadOnlyWalletClient, buildEpochWalletClient, getEvmConnection } from "./client";
import { EPOCH_ALLOCATOR_URL, MIDEN_DESTINATION_CHAIN_ID } from "./config";

/**
 * Ported from miden-wallet/src/lib/epoch/sdk.ts and adapted for this app.
 * Singleton Epoch SDK getters keyed on (address, flow).
 */

type SdkCache = { address: string; chainId: number; sdk: EpochIntentSDK };

let defaultCache: SdkCache | null = null;
let midenCache: SdkCache | null = null;
let readOnlyCache: SdkCache | null = null;

async function buildSdk(address: `0x${string}`, chainOverride?: number): Promise<EpochIntentSDK> {
  const walletClient = await buildEpochWalletClient(address, { chainOverride });
  return new EpochIntentSDK({
    apiBaseUrl: EPOCH_ALLOCATOR_URL,
    walletClient,
  });
}

/**
 * Singleton SDK getter. Returns null while disconnected so callers can early-out.
 *
 * - `forMidenFlow: true` → fresh walletClient with chain.id = 999999999 (Miden→EVM).
 * - default → walletClient with chain.id = Sepolia (EVM→Miden and everything else).
 *
 * Caches one instance per (address, flow) so repeated calls in a single
 * session don't rebuild. Disconnected reads invalidate the connected caches.
 */
export async function getEpochSdk(opts?: { forMidenFlow?: boolean }): Promise<EpochIntentSDK | null> {
  const { address } = await getEvmConnection();
  if (!address) {
    // WC disconnected — invalidate any SDK still pointing at a now-stale
    // provider/account so the next connect rebuilds cleanly.
    defaultCache = null;
    midenCache = null;
    return null;
  }
  const chainId = opts?.forMidenFlow ? MIDEN_DESTINATION_CHAIN_ID : sepolia.id;
  const slot = opts?.forMidenFlow ? midenCache : defaultCache;
  if (slot && slot.address === address && slot.chainId === chainId) {
    return slot.sdk;
  }
  const sdk = await buildSdk(address as `0x${string}`, opts?.forMidenFlow ? MIDEN_DESTINATION_CHAIN_ID : undefined);
  const entry: SdkCache = { address, chainId, sdk };
  if (opts?.forMidenFlow) {
    midenCache = entry;
  } else {
    defaultCache = entry;
  }
  return sdk;
}

/**
 * Read-only Miden→EVM SDK that needs NO connected EVM wallet — the EVM leg is
 * solver-fulfilled against a Miden-side P2IDE note, so nothing is signed on EVM.
 * `sponsorAddress` is the destination, which doubles as the walletClient account.
 * Used by the send-flow Fast route (quote + send) so the user only supplies the
 * recipient address. Caches one instance per destination.
 */
export async function getEpochReadOnlySdk(destinationAddress: `0x${string}`): Promise<EpochIntentSDK> {
  const chainId = MIDEN_DESTINATION_CHAIN_ID;
  if (readOnlyCache && readOnlyCache.address === destinationAddress && readOnlyCache.chainId === chainId) {
    return readOnlyCache.sdk;
  }
  const walletClient = buildEpochReadOnlyWalletClient(destinationAddress, {
    chainOverride: MIDEN_DESTINATION_CHAIN_ID,
  });
  const sdk = new EpochIntentSDK({ apiBaseUrl: EPOCH_ALLOCATOR_URL, walletClient });
  readOnlyCache = { address: destinationAddress, chainId, sdk };
  return sdk;
}

export function resetEpochSdk(): void {
  defaultCache = null;
  midenCache = null;
  readOnlyCache = null;
}
