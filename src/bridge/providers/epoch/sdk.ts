"use client";
import type { BridgeConfig } from "../../../config/bridge-config";
import { assertConfigNetwork } from "../../../config/bridge-config";
import type { EvmNetwork } from "../../core/assets";

import { EpochIntentSDK } from "@epoch-protocol/epoch-intents-sdk";
import { getAddress } from "viem";
import { evmNetworks } from "../../../config/evm-networks";
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
  let depositTracking;
  if (tracking) {
    // SDK 2.2 resolves its deployment from this service, not its static exports.
    const readOnlySdk = await getEpochReadOnlySdk(address as `0x${string}`, recovery, network);
    const health = await readOnlySdk.getHealthCheck();
    const compactAddress = health.compactAddresses?.[evmNetworks[network].id];
    if (!compactAddress) throw new Error("Epoch has no Compact address configured for this network.");
    depositTracking = { ...tracking, compactAddress: getAddress(compactAddress) };
  }
  const walletClient = await buildEpochWalletClient(address as `0x${string}`, network, depositTracking);
  return new EpochIntentSDK({ apiBaseUrl, walletClient, allowGaslessSmartAccount: false });
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
