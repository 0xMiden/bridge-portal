import { formatUnits } from "viem";

import {
  BRIDGEABLE_EVM_OUTPUT_TOKEN_ADDRESS,
  BRIDGEABLE_EVM_OUTPUT_TOKEN_DECIMALS,
  BRIDGEABLE_EVM_OUTPUT_TOKEN_SYMBOL,
  EPOCH_DESTINATION_CHAIN_ID,
  isBridgeableEvmTokenConfigured,
} from "./bridgeable-token";
import { getCrossChainQuote, getEVMToMidenQuote } from "./bridge";
import { getCurrentMidenBlock, MIDEN_MIN_RECLAIM_BLOCKS } from "./chain";
import {
  MIDEN_DESTINATION_CHAIN_ID,
  MIDEN_NATIVE_FAUCET_ID,
  MIDEN_NATIVE_TOKEN_DECIMALS,
  MIDEN_NATIVE_TOKEN_SYMBOL,
} from "./config";
import { getEpochReadOnlySdk, getEpochSdk } from "./sdk";
import type { CrossChainIntentParams, EVMToMidenIntentParams } from "./types";

export interface EpochQuoteOutput {
  /** Estimated output amount, human-formatted to 2 decimals. */
  amount: string;
  /** Output token symbol. */
  symbol: string;
}

/**
 * Format an Epoch quote amount (base units, or an already-human decimal) to a
 * 2-decimal display string. Mirrors the wallet's send-quote formatting.
 */
function formatQuoteAmount(raw: string, decimals: number): string {
  if (!raw || raw === "0") return "0.00";
  try {
    const human = /^\d+\.\d+$/.test(raw)
      ? raw
      : formatUnits(BigInt(raw), decimals);
    const n = Number(human);
    return Number.isFinite(n) ? n.toFixed(2) : human;
  } catch {
    return raw;
  }
}

/**
 * Forward-quote the EVM output (USDC) for a Miden→EVM send WITHOUT executing.
 * Uses the read-only SDK — no connected EVM wallet needed, only the recipient
 * address (which doubles as the intent sponsor). `minTokenOut: "0"` = no
 * slippage floor (testnet); the backend derives the output from `amount`.
 */
export async function quoteEpochSend(args: {
  /** Miden faucet token amount, base units. */
  amount: bigint;
  /** EVM recipient (0x) — also the sponsor. */
  destinationAddress: `0x${string}`;
  /** Sender's Miden account (bech32 or hex). */
  senderPublicKey: string;
}): Promise<EpochQuoteOutput> {
  if (!isBridgeableEvmTokenConfigured()) {
    throw new Error("The Epoch route is not configured yet.");
  }
  const sdk = await getEpochReadOnlySdk(args.destinationAddress);
  const currentBlock = await getCurrentMidenBlock();
  const params: CrossChainIntentParams = {
    midenAccountId: args.senderPublicKey,
    midenFaucetId: MIDEN_NATIVE_FAUCET_ID,
    midenAmount: args.amount.toString(),
    evmRecipient: args.destinationAddress,
    destinationChainId: EPOCH_DESTINATION_CHAIN_ID,
    outputTokenAddress: BRIDGEABLE_EVM_OUTPUT_TOKEN_ADDRESS,
    outputTokenDecimals: BRIDGEABLE_EVM_OUTPUT_TOKEN_DECIMALS,
    minTokenOut: "0",
    midenReclaimHeight: currentBlock + MIDEN_MIN_RECLAIM_BLOCKS,
  };
  const quote = await getCrossChainQuote(sdk, params, args.destinationAddress);
  const raw =
    quote.quoteResult.tokenOut != null
      ? String(quote.quoteResult.tokenOut)
      : "0";
  return {
    amount: formatQuoteAmount(raw, BRIDGEABLE_EVM_OUTPUT_TOKEN_DECIMALS),
    symbol: BRIDGEABLE_EVM_OUTPUT_TOKEN_SYMBOL,
  };
}

/**
 * Forward-quote the Miden output for an EVM→Miden receive WITHOUT executing.
 * Needs a connected EVM wallet (the SDK signs the eventual deposit), so it
 * resolves the default SDK keyed on the connected account.
 */
export async function quoteEpochReceive(args: {
  /** EVM input amount, human-readable (parsed at the SDK boundary). */
  evmAmount: string;
  /** Connected EVM source (0x) — also the intent sponsor. */
  evmSourceAddress: `0x${string}`;
  /** Miden recipient account (bech32 or hex). */
  midenRecipientId: string;
}): Promise<EpochQuoteOutput> {
  if (!isBridgeableEvmTokenConfigured()) {
    throw new Error("The Epoch route is not configured yet.");
  }
  const sdk = await getEpochSdk();
  if (!sdk) {
    throw new Error("Connect a Sepolia wallet to quote the Epoch route.");
  }
  const params: EVMToMidenIntentParams = {
    sourceChainId: EPOCH_DESTINATION_CHAIN_ID,
    destinationChainId: MIDEN_DESTINATION_CHAIN_ID,
    evmSourceAddress: args.evmSourceAddress,
    evmTokenAddress: BRIDGEABLE_EVM_OUTPUT_TOKEN_ADDRESS,
    evmAmount: args.evmAmount,
    evmTokenDecimals: BRIDGEABLE_EVM_OUTPUT_TOKEN_DECIMALS,
    midenRecipientId: args.midenRecipientId,
    midenFaucetId: MIDEN_NATIVE_FAUCET_ID,
    minTokenOut: "0",
  };
  const quote = await getEVMToMidenQuote(sdk, params, args.evmSourceAddress);
  const raw =
    quote.quoteResult.tokenOut != null
      ? String(quote.quoteResult.tokenOut)
      : "0";
  return {
    amount: formatQuoteAmount(raw, MIDEN_NATIVE_TOKEN_DECIMALS),
    symbol: MIDEN_NATIVE_TOKEN_SYMBOL,
  };
}
