"use client";
import type { BridgeConfig } from "../../../config/bridge-config";
import { assertConfigNetwork } from "../../../config/bridge-config";
import type { EvmNetwork } from "../../core/assets";

import { EpochIntentSDK } from "@epoch-protocol/epoch-intents-sdk";
import { buildEpochReadOnlyWalletClient, buildEpochWalletClient, getEvmConnection } from "./client";
import { epochAllocatorUrl } from "./config";
import type { EpochDepositTracking } from "./deposit-tracking";

type SdkCache = { key: string; sdk: EpochIntentSDK };
let readOnlyCache: SdkCache | null = null;

/** Resolve the current connection again before signing a collateral deposit. */
export async function getEpochSdk(recovery: BridgeConfig, network: EvmNetwork, tracking?: EpochDepositTracking): Promise<EpochIntentSDK | null> {
  assertConfigNetwork(recovery, network);
  const { address } = await getEvmConnection();
  if (!address) return null;
  if (tracking && tracking.sponsor.toLowerCase() !== address.toLowerCase())
    throw new Error("Your connected wallet changed. Review the transfer again.");
  const apiBaseUrl = epochAllocatorUrl(recovery);
  const walletClient = await buildEpochWalletClient(address as `0x${string}`, network, tracking);
  return new EpochIntentSDK({ apiBaseUrl, walletClient });
}

/** Miden sends and status reads need a sponsor address, without an EVM signer. */
export async function getEpochReadOnlySdk(destinationAddress: `0x${string}`, recovery?: BridgeConfig, sourceNetwork?: EvmNetwork): Promise<EpochIntentSDK> {
  const apiBaseUrl = epochAllocatorUrl(recovery);
  const network = sourceNetwork ?? (recovery?.environment === "mainnet" ? "ethereum" : "sepolia");
  if (recovery) assertConfigNetwork(recovery, network);
  const key = `${apiBaseUrl}:${destinationAddress.toLowerCase()}:${sourceNetwork ?? "miden"}`;
  if (readOnlyCache?.key === key) return readOnlyCache.sdk;
  const walletClient = buildEpochReadOnlyWalletClient(destinationAddress, network, !sourceNetwork);
  const sdk = new EpochIntentSDK({ apiBaseUrl, walletClient });
  readOnlyCache = { key, sdk };
  return sdk;
}
