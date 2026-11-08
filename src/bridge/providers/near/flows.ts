import type { ProviderFlows } from "../../core/provider";
import { fetchNearQuote } from "./client";
import { submitNearTransfer } from "./execute";
import { nearMonitor } from "./tracking";

export const flows: ProviderFlows = {
  send: { quote: (input, signal) => fetchNearQuote(input, true, signal), submit: submitNearTransfer, monitor: nearMonitor },
  receive: { quote: (input, signal) => fetchNearQuote(input, true, signal), submit: submitNearTransfer, monitor: nearMonitor },
};
