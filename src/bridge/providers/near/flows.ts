import type { ProviderFlows } from "../../core/provider";
import { fetchNearQuote } from "./client";
import { submitNearTransfer } from "./execute";
import { nearMonitor } from "./tracking";

export const flows: ProviderFlows = {
  send: { quote: (input, signal) => fetchNearQuote(input, true, signal), submit: submitNearTransfer, monitor: nearMonitor },
  receive: {
    quote: async () => null,
    submit: async () => { throw new Error("NEAR only supports Send from Miden."); },
    monitor: { canPoll: () => false, observe: async () => ({ patch: {} }) },
  },
};
