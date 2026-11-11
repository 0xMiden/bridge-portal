import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getAddress } from "viem";
import { assetKey } from "../../../bridge/core/assets";
import type { BridgeRoute } from "../../../bridge/core/routes";
import { readLockedDeposit } from "../../../bridge/providers/epoch/recovery";
import { executeRecovery } from "../../../bridge/providers/epoch/recovery-execute";
import { errorMessage } from "../../lib/wallet-errors";
import { useLockNetworkSelection } from "../NetworkProvider";
import type { BridgeWallets } from "./use-bridge-wallets";

/** Check the source lock before a new Fast deposit. */
export function useFastWithdrawal(route: BridgeRoute, wallets: BridgeWallets) {
  const asset = route.provider === "epoch" && route.source.kind !== "miden" ? route.source : undefined;
  const sponsor = wallets.accounts.evmAddress ? getAddress(wallets.accounts.evmAddress) : undefined;
  const enabled = Boolean(asset && sponsor);
  const environment = route.recovery.environment;
  const queryClient = useQueryClient();
  const lockSelection = useLockNetworkSelection();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const query = useQuery({
    queryKey: ["compact-recovery", environment, sponsor, asset ? assetKey(asset) : ""],
    enabled,
    retry: false,
    staleTime: 0,
    queryFn: () => {
      if (!asset || !sponsor) throw new Error("Connect the source wallet first.");
      return readLockedDeposit(asset, environment, sponsor);
    },
  });
  const active = enabled && !query.isError && Boolean(query.data && query.data.status !== 0);
  const blocked = enabled && (query.isPending || query.isError || active || pending);

  async function disable() {
    setError("");
    setPending(true);
    const unlock = lockSelection();
    try {
      if (!sponsor || !wallets.evm.provider || !query.data) throw new Error("Connect the source wallet first.");
      await executeRecovery(query.data, "cancel", sponsor, environment, wallets.evm.provider);
      return true;
    } catch (cause) {
      setError(errorMessage(cause));
      return false;
    } finally {
      await queryClient.invalidateQueries({ queryKey: ["compact-recovery", environment, sponsor] });
      setPending(false);
      unlock();
    }
  }

  async function verify() {
    if (!enabled) return;
    const result = await query.refetch();
    if (result.isError) throw new Error("Could not check the Fast withdrawal status. Try again.");
    if (result.data?.status !== 0) throw new Error("Disable withdrawal for this token before you bridge again.");
  }

  return { enabled, active, blocked, pending, error, failed: enabled && query.isError,
    checking: enabled && query.isPending, disable, verify, refresh: query.refetch };
}

export type FastWithdrawal = ReturnType<typeof useFastWithdrawal>;
