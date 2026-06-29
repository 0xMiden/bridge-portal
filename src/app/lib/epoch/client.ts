"use client";

import { getAccount, getWalletClient } from "@wagmi/core";
import { type Chain, type EIP1193Provider, type WalletClient, createWalletClient, custom, http } from "viem";
import { sepolia } from "viem/chains";

import { wagmiAdapter } from "../appkit-config";
import { MIDEN_DESTINATION_CHAIN_ID } from "./config";

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

/**
 * Build a viem WalletClient backed by the connected AppKit/wagmi wallet.
 *
 * For Miden→EVM flows pass `{ chainOverride: MIDEN_DESTINATION_CHAIN_ID }` —
 * per Epoch's docs the walletClient's chain.id must be 999999999 before
 * solveIntent so the SDK routes the Miden input correctly. We build a fresh
 * walletClient with that chain id over the real wallet's EIP-1193 provider
 * rather than mutating a shared instance.
 */
export async function buildEpochWalletClient(
  address: `0x${string}`,
  opts?: { chainOverride?: number },
): Promise<WalletClient> {
  const chain: Chain =
    opts?.chainOverride !== undefined && opts.chainOverride !== sepolia.id
      ? { ...sepolia, id: opts.chainOverride }
      : sepolia;
  // wagmi's walletClient is EIP-1193 compliant (exposes `request`), so viem's
  // `custom()` transport adapts it without further plumbing.
  const walletClient = await getWalletClient(wagmiConfig);
  return createWalletClient({
    account: address,
    chain,
    transport: custom(walletClient as unknown as EIP1193Provider),
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
  opts?: { chainOverride?: number },
): WalletClient {
  const chain: Chain =
    opts?.chainOverride !== undefined && opts.chainOverride !== sepolia.id
      ? { ...sepolia, id: opts.chainOverride }
      : sepolia;
  const rpcUrl = sepolia.rpcUrls.default.http[0] ?? "";
  return createWalletClient({
    account: address,
    chain,
    transport: http(rpcUrl),
  });
}

export { MIDEN_DESTINATION_CHAIN_ID };
