"use client";
import type { BridgeConfig } from "../../../config/bridge-config";
import { assertConfigNetwork } from "../../../config/bridge-config";
import type { EvmAsset, EvmNetwork } from "../../core/assets";

import { EpochIntentSDK } from "@epoch-protocol/epoch-intents-sdk";
import { getAddress } from "viem";
import { buildEpochReadOnlyWalletClient, buildEpochWalletClient, getEvmConnection } from "./client";
import { epochAllocatorUrl } from "./config";
import type { EpochDepositTracking } from "./deposit-tracking";
import { configuredRecoveryLock, readEpochHealth, readLockedDeposit } from "./recovery";

type SdkCache = { key: string; sdk: EpochIntentSDK };
let readOnlyCache: SdkCache | null = null;

/** Resolve the current connection again before signing a collateral deposit. */
export async function getEpochSdk(recovery: BridgeConfig, asset: EvmAsset, tracking: EpochDepositTracking): Promise<EpochIntentSDK | null> {
  assertConfigNetwork(recovery, asset.network);
  const { address } = await getEvmConnection();
  if (!address) return null;
  if (tracking.sponsor.toLowerCase() !== address.toLowerCase())
    throw new Error("Your connected wallet changed. Review the transfer again.");
  const sponsor = getAddress(address);
  const serviceHealth = await readEpochHealth(recovery);
  const lock = configuredRecoveryLock(asset, serviceHealth);
  const { status } = await readLockedDeposit(lock, sponsor);
  if (status !== 0) throw new Error("Cancel the withdrawal to make a Fast deposit.");
  const walletClient = await buildEpochWalletClient(sponsor, asset.network, { ...tracking, compactAddress: lock.compactAddress });
  return new EpochIntentSDK({ apiBaseUrl: epochAllocatorUrl(recovery), walletClient, allowGaslessSmartAccount: false, serviceHealth });
}

/** Miden sends and status reads need a sponsor address, without an EVM signer. */
export async function getEpochReadOnlySdk(destinationAddress: `0x${string}`, recovery?: BridgeConfig, sourceNetwork?: EvmNetwork): Promise<EpochIntentSDK> {
  const apiBaseUrl = epochAllocatorUrl(recovery);
  const network = sourceNetwork ?? (recovery?.environment === "mainnet" ? "ethereum" : "sepolia");
  if (recovery) assertConfigNetwork(recovery, network);
  const key = `${apiBaseUrl}:${destinationAddress.toLowerCase()}:${sourceNetwork ?? "miden"}`;
  if (readOnlyCache?.key === key) return readOnlyCache.sdk;
  const walletClient = buildEpochReadOnlyWalletClient(destinationAddress, network, !sourceNetwork);
  const sdk = new EpochIntentSDK({ apiBaseUrl, walletClient, allowGaslessSmartAccount: false });
  readOnlyCache = { key, sdk };
  return sdk;
}
