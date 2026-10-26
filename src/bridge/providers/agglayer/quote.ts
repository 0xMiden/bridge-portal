import { createPublicClient, formatUnits, parseAbi, parseUnits } from "viem";
import type { QuoteRequest, QuoteResult } from "../../core/quote";
import { validateTransferAmount } from "../../core/rules";
import { evmReadTransport } from "../../evm/transport";
import { agglayerConfig } from "./agglayer";

const bridgeStatusAbi = parseAbi(["function isEmergencyState() view returns (bool)"]);

/** Agglayer bridges the same asset; gas is paid separately from the payout. */
export async function quoteAgglayer(input: QuoteRequest, signal: AbortSignal): Promise<QuoteResult> {
  const { route, amount } = input;
  validateTransferAmount(route, amount);
  signal.throwIfAborted();
  const config = agglayerConfig(route.recovery);
  const client = createPublicClient({ chain: config.chain, transport: evmReadTransport(config.evmNetwork) });
  const paused = await client.readContract({
    address: config.sepoliaBridgeAddress,
    abi: bridgeStatusAbi,
    functionName: "isEmergencyState",
  });
  signal.throwIfAborted();
  if (paused) throw new Error("Agglayer is temporarily paused.");

  // Validate precision before converting: ETH has 18 decimals on EVM and 8 on Miden.
  // Never infer this payout in the UI when the live bridge read fails.
  return {
    kind: "agglayer",
    received: formatUnits(parseUnits(amount.trim(), route.destination.decimals), route.destination.decimals),
    validity: { kind: "time", expiresAt: Date.now() + 60_000 },
  };
}
