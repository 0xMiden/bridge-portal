"use client";

import { useEffect, useRef, useState } from "react";
import { parseUnits } from "viem";

import {
  MIDEN_NATIVE_TOKEN_DECIMALS,
  MIDEN_NATIVE_TOKEN_SYMBOL,
} from "./config";
import { quoteEpochReceive, quoteEpochSend } from "./epoch-quote";

export interface EpochQuoteState {
  /** Whether the Epoch route is the active provider (drives whether to show this). */
  enabled: boolean;
  loading: boolean;
  /** Estimated output amount, human-formatted. */
  amount?: string;
  /** Output token symbol. */
  symbol?: string;
  error?: string;
}

export interface UseEpochQuoteOpts {
  /** Gate: only quote when the Epoch route is active. */
  enabled: boolean;
  mode: "receive" | "send";
  /** Human input amount as typed. */
  amount: string;
  /** Sender (send) / recipient (receive) Miden account. */
  midenAccount?: string;
  /** Destination (send) / source (receive) EVM address — must be 0x. */
  evmAddress?: string;
}

const DEBOUNCE_MS = 500;
const isEvmAddress = (v?: string): v is `0x${string}` =>
  !!v && /^0x[0-9a-fA-F]{40}$/.test(v);

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Quote failed";
}

/**
 * Debounced forward-quote for the Epoch route, both directions. Returns
 * `{ loading, amount, symbol, error }` for a "you receive ~N" preview. The
 * Miden side is fixed to the chain's native MIDEN asset; the EVM side is fixed
 * to USDC. In-flight requests are superseded by a request id so a slow earlier
 * quote can't overwrite a newer one.
 *
 * setState is always deferred via queueMicrotask/timeout so none of it runs
 * synchronously in the effect body (react-hooks/set-state-in-effect).
 */
export function useEpochQuote({
  enabled,
  mode,
  amount,
  midenAccount,
  evmAddress,
}: UseEpochQuoteOpts): EpochQuoteState {
  const amountNum = Number(amount);
  const ready =
    enabled &&
    Number.isFinite(amountNum) &&
    amountNum > 0 &&
    !!midenAccount &&
    isEvmAddress(evmAddress);

  const [state, setState] = useState<EpochQuoteState>({
    enabled,
    loading: false,
  });
  const reqId = useRef(0);

  useEffect(() => {
    const id = ++reqId.current;

    if (!ready || !midenAccount || !isEvmAddress(evmAddress)) {
      queueMicrotask(() => {
        if (id === reqId.current) setState({ enabled, loading: false });
      });
      return;
    }

    // Show loading right away; run the network quote after the debounce window.
    queueMicrotask(() => {
      if (id === reqId.current) setState({ enabled, loading: true });
    });

    const handle = window.setTimeout(() => {
      void (async () => {
        try {
          const result =
            mode === "send"
              ? await quoteEpochSend({
                  amount: parseUnits(amount, MIDEN_NATIVE_TOKEN_DECIMALS),
                  destinationAddress: evmAddress,
                  senderPublicKey: midenAccount,
                })
              : await quoteEpochReceive({
                  evmAmount: amount,
                  evmSourceAddress: evmAddress,
                  midenRecipientId: midenAccount,
                });
          if (id === reqId.current) {
            setState({
              enabled,
              loading: false,
              amount: result.amount,
              symbol: result.symbol,
            });
          }
        } catch (err) {
          if (id === reqId.current) {
            setState({ enabled, loading: false, error: errorMessage(err) });
          }
        }
      })();
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(handle);
  }, [ready, enabled, mode, amount, midenAccount, evmAddress]);

  return state;
}
