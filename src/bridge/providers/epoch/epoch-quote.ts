import { formatUnits, parseUnits } from "viem";
import type { QuoteRequest, QuoteResult } from "../../core/quote";
import { EPOCH_DESTINATION_CHAIN_ID, epochRouteAssets } from "./bridgeable-token";
import { getCrossChainQuote, getEVMToMidenQuote } from "./bridge";
import { MIDEN_DESTINATION_CHAIN_ID } from "./config";
import { getEpochReadOnlySdk, getEpochSdk } from "./sdk";

/** Quote both directions without executing or requesting a signature. */
export async function quoteEpochSend(input: QuoteRequest): Promise<QuoteResult> {
  const { miden, evm } = epochRouteAssets(input.route);
  const address = evmAddress(input.evmAddress);
  const sdk = await getEpochReadOnlySdk(address, input.route.deploymentId);
  const quote = await getCrossChainQuote(
    sdk,
    {
      midenAccountId: input.midenAccount,
      midenFaucetId: miden.faucetId,
      midenAmount: parseUnits(input.amount, miden.decimals).toString(),
      evmRecipient: address,
      destinationChainId: EPOCH_DESTINATION_CHAIN_ID,
      outputTokenAddress: evm.address,
      minTokenOut: "0",
    },
    address,
  );
  return result(quote.quoteResult.tokenOut, evm.decimals);
}

export async function quoteEpochReceive(input: QuoteRequest): Promise<QuoteResult> {
  const { miden, evm } = epochRouteAssets(input.route);
  const address = evmAddress(input.evmAddress);
  const sdk = await getEpochSdk(input.route.deploymentId);
  if (!sdk) throw new Error("Connect a Sepolia wallet to quote the Epoch route.");
  const quote = await getEVMToMidenQuote(
    sdk,
    {
      destinationChainId: MIDEN_DESTINATION_CHAIN_ID,
      evmSourceAddress: address,
      evmTokenAddress: evm.address,
      evmAmount: input.amount,
      evmTokenDecimals: evm.decimals,
      midenRecipientId: input.midenAccount,
      midenFaucetId: miden.faucetId,
      minTokenOut: "0",
    },
    address,
  );
  return result(quote.quoteResult.tokenOut, miden.decimals);
}

function evmAddress(value: string): `0x${string}` {
  if (!/^0x[\da-f]{40}$/i.test(value)) throw new Error("Enter a valid EVM address.");
  return value as `0x${string}`;
}

function result(tokenOut: unknown, decimals: number): QuoteResult {
  const received = formatUnits(BigInt(String(tokenOut ?? "0")), decimals);
  if (!(Number(received) > 0)) throw new Error("No liquidity available for this transfer.");
  return { kind: "epoch", received, expiresAt: Date.now() + 60_000 };
}
