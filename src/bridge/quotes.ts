import type { QuoteRequest, TransferQuote } from "./core/quote";
import { bridgeProviders } from "./providers/registry";

export async function quoteTransfer(
  input: QuoteRequest,
  signal: AbortSignal,
): Promise<TransferQuote | null> {
  const { flows } = await bridgeProviders[input.route.provider].load();
  signal.throwIfAborted();
  const quote = await flows[input.route.mode].quote(input, signal);
  signal.throwIfAborted();
  return (
    quote && {
      ...quote,
      request: {
        routeId: input.route.id,
        deploymentId: input.route.deploymentId,
        amount: input.amount,
        midenAccount: input.midenAccount,
        evmAddress: input.evmAddress,
      },
    }
  );
}
