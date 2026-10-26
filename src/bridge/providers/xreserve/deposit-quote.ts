import { createPublicClient, formatUnits } from "viem";
import type { QuoteRequest, QuoteResult } from "../../core/quote";
import { evmReadTransport } from "../../evm/transport";
import { arcConfig } from "./config";
import { assertArcRouteAvailable } from "./deposit-preflight";
import { parseArcAmount } from "./deposit-terms";

/** Direct Arc deposits mint the same USDC amount as USDCx, with gas paid separately. */
export async function quoteArcDeposit(input: QuoteRequest, signal: AbortSignal): Promise<QuoteResult> {
  const amount = parseArcAmount(input.amount);
  const arc = arcConfig(input.route.recovery);
  const client = createPublicClient({ chain: arc.chain, transport: evmReadTransport(arc.network) });
  signal.throwIfAborted();
  await assertArcRouteAvailable(client, arc);
  signal.throwIfAborted();
  return {
    kind: "arc-deposit", received: formatUnits(amount, arc.decimals),
    validity: { kind: "time", expiresAt: Date.now() + 60_000 },
  };
}
