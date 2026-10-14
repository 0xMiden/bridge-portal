"use client";
import { useQuery } from "@tanstack/react-query";
import { fetchWithdrawalQuote, validateWithdrawalQuoteRequest, type WithdrawalQuoteRequest } from "../../bridge/providers/xreserve/withdrawal-quote";

export function useWithdrawalQuote(input: WithdrawalQuoteRequest | null, frozen: boolean) {
  let valid = false;
  try { if (input) { validateWithdrawalQuoteRequest(input); valid = true; } } catch { /* Incomplete form. */ }
  return useQuery({
    queryKey: ["withdrawal-quote", input], enabled: valid && !frozen,
    queryFn: ({ signal }) => fetchWithdrawalQuote(input!, signal),
    staleTime: 30_000, refetchInterval: frozen ? false : 45_000, retry: false,
  });
}
