import type { BridgeRoute } from "../../core/routes";
import {
  EPOCH_DESTINATION_CHAIN_ID,
  epochRouteAssets,
} from "./bridgeable-token";
import { getCrossChainQuote, getEVMToMidenQuote } from "./bridge";
import { MIDEN_DESTINATION_CHAIN_ID } from "./config";
import { getEpochReadOnlySdk, getEpochSdk } from "./sdk";
import type { CrossChainIntentParams, EVMToMidenIntentParams } from "./types";

export interface EpochQuoteOutput {
  /** Provider output amount: base units or an already-decimal SDK response. */
  amount: string;
  /** Decimals used when the SDK returns base units. */
  decimals: number;
  /** Output token symbol. */
  symbol: string;
}

/**
 * Forward-quote the EVM output token for a Miden→EVM send WITHOUT executing.
 * Uses the read-only SDK — no connected EVM wallet needed, only the recipient
 * address (which doubles as the intent sponsor). `minTokenOut: "0"` = no
 * slippage floor (testnet); the backend derives the output from `amount`.
 */
export async function quoteEpochSend(args: {
  route: BridgeRoute;
  /** Miden faucet token amount, base units. */
  amount: bigint;
  /** EVM recipient (0x) — also the sponsor. */
  destinationAddress: `0x${string}`;
  /** Sender's Miden account (bech32 or hex). */
  senderPublicKey: string;
}): Promise<EpochQuoteOutput> {
  const { miden, evm } = epochRouteAssets(args.route);
  const sdk = await getEpochReadOnlySdk(args.destinationAddress);
  const params: CrossChainIntentParams = {
    midenAccountId: args.senderPublicKey,
    midenFaucetId: miden.faucetId,
    midenAmount: args.amount.toString(),
    evmRecipient: args.destinationAddress,
    destinationChainId: EPOCH_DESTINATION_CHAIN_ID,
    outputTokenAddress: evm.address,
    outputTokenDecimals: evm.decimals,
    minTokenOut: "0",
  };
  const quote = await getCrossChainQuote(sdk, params, args.destinationAddress);
  const raw =
    quote.quoteResult.tokenOut != null
      ? String(quote.quoteResult.tokenOut)
      : "0";
  return {
    amount: raw,
    decimals: evm.decimals,
    symbol: evm.symbol,
  };
}

/**
 * Forward-quote the Miden output for an EVM→Miden receive WITHOUT executing.
 * Needs a connected EVM wallet (the SDK signs the eventual deposit), so it
 * resolves the default SDK keyed on the connected account.
 */
export async function quoteEpochReceive(args: {
  route: BridgeRoute;
  /** EVM input amount, human-readable (parsed at the SDK boundary). */
  evmAmount: string;
  /** Connected EVM source (0x) — also the intent sponsor. */
  evmSourceAddress: `0x${string}`;
  /** Miden recipient account (bech32 or hex). */
  midenRecipientId: string;
}): Promise<EpochQuoteOutput> {
  const { miden, evm } = epochRouteAssets(args.route);
  const sdk = await getEpochSdk();
  if (!sdk) {
    throw new Error("Connect a Sepolia wallet to quote the Epoch route.");
  }
  const params: EVMToMidenIntentParams = {
    sourceChainId: EPOCH_DESTINATION_CHAIN_ID,
    destinationChainId: MIDEN_DESTINATION_CHAIN_ID,
    evmSourceAddress: args.evmSourceAddress,
    evmTokenAddress: evm.address,
    evmAmount: args.evmAmount,
    evmTokenDecimals: evm.decimals,
    midenRecipientId: args.midenRecipientId,
    midenFaucetId: miden.faucetId,
    minTokenOut: "0",
  };
  const quote = await getEVMToMidenQuote(sdk, params, args.evmSourceAddress);
  const raw =
    quote.quoteResult.tokenOut != null
      ? String(quote.quoteResult.tokenOut)
      : "0";
  return {
    amount: raw,
    decimals: miden.decimals,
    symbol: miden.symbol,
  };
}
