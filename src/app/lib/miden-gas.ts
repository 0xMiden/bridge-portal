"use client";

import { queryOptions, useQuery } from "@tanstack/react-query";
import { formatUnits } from "viem";
import { getMidenVerificationBaseFee } from "../../bridge/miden-rpc";
import { configMidenNetwork, type BridgeConfig } from "../../config/bridge-config";

// Match Bread's conservative fee reserve. The actual fee is baseFee ×
// (floor(log2(execution cycles)) + 1); cycles are unknown before execution.
const FEE_RESERVE_MULTIPLE = 30n;

export function midenGasQuery(recovery: BridgeConfig, enabled: boolean) {
  return queryOptions({
    queryKey: ["miden-network-fee", configMidenNetwork(recovery).rpcUrl],
    enabled,
    queryFn: async () => {
      const baseFee = await getMidenVerificationBaseFee(recovery);
      const fee = BigInt(baseFee) * FEE_RESERVE_MULTIPLE;
      // Miden transactions pay gas in the deployment's 6-decimal USDCx,
      // independently of the bridge provider or transferred asset.
      return `${fee === 0n ? "" : "≈ "}${formatUnits(fee, 6)} USDCx`;
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: false,
  });
}

export function useMidenGasEstimate(recovery: BridgeConfig, enabled: boolean) {
  const query = useQuery(midenGasQuery(recovery, enabled));
  return enabled
    ? query.isError ? "Unavailable" : query.isSuccess ? query.data : "Estimating…"
    : undefined;
}
