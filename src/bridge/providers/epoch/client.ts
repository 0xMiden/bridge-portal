"use client";

import { getAccount, getWalletClient } from "@wagmi/core";
import { type EIP1193Provider, type WalletClient, createWalletClient, custom } from "viem";
import type { EvmNetwork } from "../../core/assets";
import { evmNetworks } from "../../../config/evm-networks";

import { wagmiAdapter } from "../../../wallets/evm/appkit-config";
import { evmReadTransport } from "../../evm/transport";
import { MIDEN_DESTINATION_CHAIN_ID } from "./config";
import { trackEpochDeposits, type EpochDepositTracking } from "./deposit-tracking";
import type { EvmProvider } from "../../../wallets/evm/evm-wallet";

/**
 * Ported from miden-wallet/src/lib/epoch/client.ts and adapted for this app.
 *
 * The wallet had to bridge two WalletConnect backends (native Reown on mobile +
 * wagmi/AppKit on web). This app only has the wagmi v2 + AppKit web path, so the
 * native branch is dropped and the connection is read straight from the shared
 * wagmi config that backs AppKit (`wagmiAdapter.wagmiConfig`).
 */
const wagmiConfig = wagmiAdapter.wagmiConfig;

export interface EvmConnection {
  address?: string;
  chainId?: number;
}

/** Resolve the active EVM connection from the AppKit/wagmi adapter. */
export async function getEvmConnection(): Promise<EvmConnection> {
  const account = getAccount(wagmiConfig);
  return { address: account.address, chainId: account.chainId };
}

/** Build the connected source-chain wallet client used for Epoch receives. */
export async function buildEpochWalletClient(
  address: `0x${string}`,
  network: EvmNetwork,
  tracking?: EpochDepositTracking & { compactAddress: string },
): Promise<WalletClient> {
  // wagmi's walletClient is EIP-1193 compliant (exposes `request`), so viem's
  // `custom()` transport adapts it without further plumbing.
  const chain = evmNetworks[network];
  const walletClient = await getWalletClient(wagmiConfig, { chainId: chain.id });
  if (walletClient.account.address.toLowerCase() !== address.toLowerCase() || await walletClient.getChainId() !== chain.id)
    throw new Error(`Connect the source wallet on ${chain.name}.`);
  return createWalletClient({
    account: address,
    chain,
    transport: custom((tracking
      ? trackEpochDeposits(walletClient as unknown as EvmProvider, chain.id, tracking)
      : walletClient) as unknown as EIP1193Provider, { retryCount: 0 }),
  });
}

/**
 * Build a READ-ONLY viem WalletClient for Miden→EVM Miden-collateral sends. Those
 * never sign an EVM transaction (the collateral is a P2IDE note on Miden and the
 * EVM leg is solver-fulfilled), so no connected EVM wallet is required — the SDK
 * just needs *a* walletClient whose `account` doubles as the intent sponsor. We
 * back it with a plain HTTP transport and use the destination address as the
 * account. This lets the Fast route quote + send with only the recipient address.
 */
export function buildEpochReadOnlyWalletClient(
  address: `0x${string}`,
  network: EvmNetwork,
  midenSource: boolean,
): WalletClient {
  const chain = evmNetworks[network];
  return createWalletClient({
    account: address,
    chain: midenSource ? { ...chain, id: MIDEN_DESTINATION_CHAIN_ID } : chain,
    transport: evmReadTransport(network),
  });
}
