"use client";
import { useQuery } from "@tanstack/react-query";
import { fetchCctpQuote, type CctpQuoteRequest } from "../../bridge/providers/xreserve/cctp-quote";
import { arcRecipient, parseArcAmount } from "../../bridge/providers/xreserve/deposit";

export function useCctpQuote(input: CctpQuoteRequest | null, frozen: boolean) {
  let valid = false;
  try {
    if (input && /^0x[\da-f]{40}$/i.test(input.sender)) {
      parseArcAmount(input.amount);
      arcRecipient(input.recipient);
      valid = true;
    }
  } catch { /* The form supplies incomplete amounts and recipients while typing. */ }
  return useQuery({
    queryKey: ["cctp-quote", input],
    enabled: valid && !frozen,
    queryFn: ({ signal }) => fetchCctpQuote(input!, signal),
    staleTime: 30_000, refetchInterval: frozen ? false : 45_000, retry: false,
  });
}
