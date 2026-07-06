"use client";

import { useEffect, useState } from "react";
import { formatEther } from "viem";
import type { BridgeProvider, FlowMode } from "./bridge-state";

// Rough gas-limit estimates for the Sepolia-side operation of each route. These
// are the units multiplied by the live gas price to produce a fee estimate;
// they don't need to be exact (the label makes clear it's an estimate), just
// representative of the operation's cost.
const GAS_UNITS: Record<string, number> = {
  // Sepolia -> Miden: canonical bridge `bridgeAsset` deposit.
  "receive:agglayer": 140_000,
  // Sepolia -> Miden: Epoch deposit/solve on the source chain.
  "receive:epoch": 150_000,
  // Miden -> Sepolia AggLayer claim (`claimAsset`) the user submits on Sepolia.
  "send:agglayer": 260_000,
};

/**
 * Gas units for the Sepolia-side operation of a route, or null when the
 * user-paid fee for that leg is on the Miden side (so there's no Sepolia gas to
 * estimate — e.g. an Epoch send whose source transaction runs on Miden).
 */
export function sepoliaGasUnitsFor(
  mode: FlowMode,
  provider: BridgeProvider,
): number | null {
  return GAS_UNITS[`${mode}:${provider}`] ?? null;
}

function formatEthFee(wei: bigint): string {
  const eth = Number(formatEther(wei));
  if (eth === 0) return "0 ETH";
  // Keep it compact but with enough precision for sub-milli-ETH testnet gas.
  const digits = eth < 0.001 ? 6 : eth < 1 ? 5 : 4;
  return `~${eth.toLocaleString(undefined, { maximumFractionDigits: digits })} ETH`;
}

export interface SepoliaGasFee {
  loading: boolean;
  /** Estimated fee, formatted (e.g. "~0.00021 ETH"). */
  fee?: string;
  /** Live gas price, formatted gwei (e.g. "1.2 gwei"). */
  gwei?: string;
  error?: string;
}

/**
 * Live Sepolia network-fee estimate for a given gas-limit. Polls the gas price
 * and returns `gasPrice * gasUnits` as an ETH string. Pass `null` to disable
 * (e.g. when the route's fee isn't on Sepolia).
 */
export function useSepoliaGasEstimate(gasUnits: number | null): SepoliaGasFee {
  const [state, setState] = useState<SepoliaGasFee>({ loading: gasUnits != null });

  useEffect(() => {
    if (gasUnits == null) {
      queueMicrotask(() => setState({ loading: false }));
      return;
    }
    const units = gasUnits;

    let cancelled = false;
    // Defer so no setState runs synchronously in the effect body.
    queueMicrotask(() => {
      if (!cancelled) setState((prev) => ({ ...prev, loading: !prev.fee }));
    });

    async function load() {
      try {
        const response = await fetch("/api/sepolia/gas", { cache: "no-store" });
        const payload = (await response.json()) as {
          gasPriceWei?: string;
          gwei?: string;
          error?: string;
        };
        if (cancelled) return;
        if (!response.ok || !payload.gasPriceWei) {
          setState({ loading: false, error: payload.error ?? "Gas price unavailable" });
          return;
        }
        const fee = BigInt(payload.gasPriceWei) * BigInt(units);
        setState({
          loading: false,
          fee: formatEthFee(fee),
          gwei: payload.gwei
            ? `${Number(payload.gwei).toLocaleString(undefined, { maximumFractionDigits: 2 })} gwei`
            : undefined,
        });
      } catch (error) {
        if (!cancelled) {
          setState({
            loading: false,
            error: error instanceof Error ? error.message : "Gas price unavailable",
          });
        }
      }
    }

    load();
    const interval = window.setInterval(load, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [gasUnits]);

  return state;
}
