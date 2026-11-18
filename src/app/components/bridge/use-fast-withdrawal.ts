import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getAddress } from "viem";
import type { BridgeRoute } from "../../../bridge/core/routes";
import { configuredRecoveryLock, readEpochHealth, readLockedDeposit, recoveryLockKey, type LockedDeposit, type RecoveryLock } from "../../../bridge/providers/epoch/recovery";
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
  const health = useQuery({
    queryKey: ["epoch-health", environment],
    enabled,
    retry: false,
    queryFn: () => readEpochHealth(route.recovery),
  });
  let lock: RecoveryLock | undefined;
  if (asset && health.data) {
    try { lock = configuredRecoveryLock(asset, health.data); } catch { /* Display a failed status check. */ }
  }
  const query = useQuery({
    queryKey: ["compact-recovery", environment, sponsor, lock ? recoveryLockKey(lock) : ""],
    enabled: Boolean(lock && sponsor && !health.isError),
    retry: false,
    staleTime: 0,
    queryFn: () => {
      if (!lock || !sponsor) throw new Error("Could not verify the deposit lock.");
      return readLockedDeposit(lock, sponsor);
    },
  });
  const failed = enabled && (health.isError || (health.isSuccess && !lock) || query.isError);
  const checking = enabled && !failed && query.isPending;
  const active = enabled && !failed && Boolean(query.data && query.data.status !== 0);
  const blocked = enabled && (checking || failed || active || pending);

  async function disable() {
    setError("");
    setPending(true);
    const unlock = lockSelection();
    try {
      if (!sponsor || !wallets.evm.provider || !query.data) throw new Error("Connect the source wallet first.");
      await executeRecovery(query.data, "cancel", sponsor, wallets.evm.provider);
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
    if (!asset || !sponsor) return;
    let deposit: LockedDeposit;
    try {
      const { data } = await health.refetch({ throwOnError: true });
      if (!data) throw new Error("Missing Epoch configuration.");
      const currentLock = configuredRecoveryLock(asset, data);
      const queryKey = ["compact-recovery", environment, sponsor, recoveryLockKey(currentLock)];
      deposit = await readLockedDeposit(currentLock, sponsor);
      queryClient.setQueryData(queryKey, deposit);
    } catch {
      throw new Error("Could not check withdrawal status. Try again.");
    }
    if (deposit.status !== 0) throw new Error("Cancel the withdrawal to make a Fast deposit.");
  }

  async function refresh() {
    if (health.isError || !lock) await health.refetch();
    else await query.refetch();
  }

  return { enabled, active, blocked, pending, error, failed, checking, disable, verify, refresh };
}

export type FastWithdrawal = ReturnType<typeof useFastWithdrawal>;
