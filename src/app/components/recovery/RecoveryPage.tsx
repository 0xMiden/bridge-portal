"use client";

import { useAppKit, useAppKitAccount, useAppKitProvider, useDisconnect } from "@reown/appkit/react";
import { skipToken, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, RefreshCcw, Wallet } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getAddress, type Address } from "viem";
import { readEpochHealth, readLockedDeposit, recoveryLockKey, recoveryLocks, type LockedDeposit, type RecoveryAction } from "../../../bridge/providers/epoch/recovery";
import { executeRecovery } from "../../../bridge/providers/epoch/recovery-execute";
import { useBalanceStore } from "../../../bridge/BalanceProvider";
import { currentBridgeConfig } from "../../../config/bridge-config";
import { evmNetworks } from "../../../config/evm-networks";
import { isUserRejection } from "../../../wallets/errors";
import type { EvmProvider } from "../../../wallets/evm/evm-wallet";
import { shortAddress } from "../../../wallets/identity";
import { errorMessage } from "../../lib/wallet-errors";
import { useActivitySnapshot } from "../ActivityProvider";
import { useBridgeEnvironment, useLockNetworkSelection, useNetworkSelectionLocked } from "../NetworkProvider";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { FormAlert } from "../ui/Feedback";
import { RecoveryDepositDetail, RecoveryDepositRow } from "./RecoveryDeposit";

export function RecoveryPage() {
  const environment = useBridgeEnvironment();
  const selectionLocked = useNetworkSelectionLocked();
  const { address, isConnected } = useAppKitAccount({ namespace: "eip155" });
  const { open } = useAppKit();
  const { disconnect } = useDisconnect();
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState("");
  const sponsor = isConnected && address ? getAddress(address) : undefined;

  async function connect() {
    setError("");
    try {
      await open({ namespace: "eip155", view: "Connect" });
    } catch (cause) {
      if (!isUserRejection(cause)) setError(errorMessage(cause));
    }
  }

  async function disconnectWallet() {
    setError("");
    setDisconnecting(true);
    try {
      await disconnect({ namespace: "eip155" });
    } catch (cause) {
      if (!isUserRejection(cause)) setError(errorMessage(cause));
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <section aria-labelledby="recovery-title" className="mx-auto mt-6 grid w-full max-w-137 gap-4 pb-10 mobile:mt-4">
      <h1 id="recovery-title" className="text-2xl font-semibold tracking-tight">Recover Epoch deposits</h1>
      <Card aria-labelledby="deposit-wallet-title" className="grid gap-3 p-3! sm:p-4!">
        <div className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 ${sponsor ? "" : "max-[360px]:grid-cols-1"}`}>
          <div className="flex min-w-0 items-center gap-3">
            <span className={`grid size-10 shrink-0 place-items-center rounded-md ${sponsor ? "bg-accent-soft text-accent-foreground" : "bg-surface-muted text-muted-foreground"}`}>
              <Wallet size={18} aria-hidden="true" />
            </span>
            <div className="grid min-w-0 gap-0.5">
              <h2 id="deposit-wallet-title" className="text-sm font-semibold">Deposit wallet</h2>
              {sponsor ? (
                <p className="font-mono text-xs text-muted-foreground wrap-anywhere" title={sponsor}>{shortAddress(sponsor)}</p>
              ) : (
                <p className="text-xs text-muted-foreground">Use the EVM wallet you deposited from.</p>
              )}
            </div>
          </div>
          {sponsor ? (
            <Button variant="secondary" className="whitespace-nowrap" type="button" disabled={selectionLocked || disconnecting} onClick={disconnectWallet}>
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </Button>
          ) : (
            <Button variant="bridge" className="w-auto! min-h-11!" type="button" disabled={disconnecting} onClick={connect}>
              Connect wallet
            </Button>
          )}
        </div>
        {error ? <FormAlert className="mt-0!">{error}</FormAlert> : null}
      </Card>
      {sponsor ? <RecoveryBalances key={`${environment}:${sponsor}`} sponsor={sponsor} disconnecting={disconnecting} /> : null}
    </section>
  );
}

function awaitingStartBlock(deposit: LockedDeposit | undefined, startBlock: bigint | undefined) {
  return startBlock !== undefined && (deposit?.blockNumber === undefined || deposit.blockNumber < startBlock);
}

function RecoveryBalances({ sponsor, disconnecting }: { sponsor: Address; disconnecting: boolean }) {
  const environment = useBridgeEnvironment();
  const lockSelection = useLockNetworkSelection();
  const { walletProvider } = useAppKitProvider<EvmProvider>("eip155");
  const queryClient = useQueryClient();
  const balances = useBalanceStore();
  const { receipts } = useActivitySnapshot();
  const [selectedKey, setSelectedKey] = useState("");
  const [pending, setPending] = useState<RecoveryAction | null>(null);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState<RecoveryAction | null>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const returnFocus = useRef("");
  const health = useQuery({
    queryKey: ["epoch-health", environment],
    queryFn: () => readEpochHealth(currentBridgeConfig(environment)),
    retry: false,
  });
  const startBlocksKey = ["compact-recovery-start-blocks", environment, sponsor] as const;
  const { data: startBlocks } = useQuery<Record<string, bigint>>({ queryKey: startBlocksKey, queryFn: skipToken, gcTime: Infinity });
  const { locks, unconfiguredAssets } = recoveryLocks(environment, sponsor, receipts.map(({ activity }) => activity), health.data);
  const results = useQueries({ queries: locks.map(lock => ({
    queryKey: ["compact-recovery", environment, sponsor, recoveryLockKey(lock)],
    queryFn: () => readLockedDeposit(lock, sponsor,
      queryClient.getQueryData<Record<string, bigint>>(startBlocksKey)?.[recoveryLockKey(lock)]),
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: true,
  })) });
  const selectedIndex = selectedKey ? locks.findIndex(lock => recoveryLockKey(lock) === selectedKey) : -1;
  const selectedResult = selectedIndex < 0 ? undefined : results[selectedIndex];
  const awaitingStart = awaitingStartBlock(selectedResult?.data, startBlocks?.[selectedKey]);
  const selected = selectedResult?.isError && !awaitingStart ? undefined : selectedResult?.data;
  const fetching = selectedResult?.isFetching ?? (health.isFetching || results.some(result => result.isFetching));
  const checking = fetching || (selectedResult?.isPending ?? (health.isPending || results.some(result => result.isPending)));
  const busy = disconnecting || pending !== null;
  const deposits = results.flatMap((result, index) => {
    if (!result.data) return [];
    const key = recoveryLockKey(locks[index]);
    return result.isError && !awaitingStartBlock(result.data, startBlocks?.[key]) ? [] : [result.data];
  }).filter(deposit => deposit.balance > 0n || deposit.status !== 0);
  const failedAssets = locks.filter((_, index) => (!selectedResult || index === selectedIndex) && results[index].isError)
    .map(({ asset }) => asset);
  const configurationFailed = !selectedResult && health.isError;
  if (!selectedResult && health.isSuccess) failedAssets.push(...unconfiguredAssets);
  const hasVisibleDeposit = selectedResult ? Boolean(selected) : deposits.length > 0;

  useEffect(() => {
    if (selectedKey) {
      backButton.current?.focus();
    } else if (returnFocus.current) {
      const row = document.getElementById(`recovery-deposit-${returnFocus.current}`);
      (row ?? listHeading.current)?.focus();
      returnFocus.current = "";
    }
  }, [selectedKey]);

  function showDeposit(key: string) {
    returnFocus.current = key;
    setSelectedKey(key);
  }

  function showDepositList() {
    setSelectedKey("");
    setError("");
    setConfirmed(null);
  }

  async function refresh(checkDeployment = false) {
    if (checkDeployment) await health.refetch();
    await queryClient.invalidateQueries({ queryKey: ["compact-recovery", environment, sponsor] });
  }

  async function recover(deposit: LockedDeposit, action: RecoveryAction) {
    setError("");
    setConfirmed(null);
    setPending(action);
    const unlock = lockSelection();
    try {
      try {
        if (!walletProvider) throw new Error("Connect your EVM wallet first.");
        const blockNumber = await executeRecovery(deposit, action, sponsor, walletProvider);
        if (action === "start") queryClient.setQueryData<Record<string, bigint>>(startBlocksKey, current => ({
          ...current, [recoveryLockKey(deposit)]: blockNumber,
        }));
        setConfirmed(action);
        await queryClient.invalidateQueries(balances.evmQuery(sponsor, deposit.asset));
      } catch (cause) {
        if (isUserRejection(cause)) return;
        setError(errorMessage(cause));
      }
      await refresh();
    } finally {
      setPending(null);
      unlock();
    }
  }

  return (
    <section aria-label={selectedResult ? "Deposit details" : "Locked deposits"} className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        {selectedResult ? (
          <button
            ref={backButton}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-sm text-left text-sm text-muted-foreground
              underline-offset-4 hover:text-foreground hover:underline disabled:opacity-60"
            type="button"
            onClick={showDepositList}
            disabled={pending !== null}
          >
            <ArrowLeft size={16} className="shrink-0" aria-hidden="true" />All locked deposits
          </button>
        ) : (
          <h2 ref={listHeading} tabIndex={-1} className="text-base font-semibold">Locked deposits</h2>
        )}
        <Button variant="toolbar" type="button" disabled={fetching || busy} onClick={() => selectedResult ? selectedResult.refetch() : refresh(true)}>
          <span className={fetching ? "motion-safe:animate-spin" : undefined}>
            <RefreshCcw size={16} aria-hidden="true" />
          </span>
          Refresh
        </Button>
      </div>
      {configurationFailed ? <FormAlert className="mt-0!">Could not check current Fast deposits.</FormAlert> : null}
      {failedAssets.length > 0 ? (
        <FormAlert className="mt-0!">
          Could not check deposits for {[...new Set(failedAssets.map(asset => `${asset.symbol} on ${evmNetworks[asset.network].name}`))].join(", ")}.
        </FormAlert>
      ) : null}
      {error ? <FormAlert className="mt-0!">{error}</FormAlert> : null}
      {confirmed === "withdraw" ? (
        <p role="status" className="rounded-md bg-success-soft p-3 text-sm text-success-foreground">Withdrawal complete.</p>
      ) : null}
      {checking ? (
        <p role="status" className={hasVisibleDeposit ? "sr-only" : "text-sm text-muted-foreground"}>
          {selectedResult ? "Checking deposit…" : "Checking deposits…"}
        </p>
      ) : null}
      {!selectedResult && !checking && !configurationFailed && !failedAssets.length && !deposits.length ? (
        <Card variant="empty" role="status" className="text-sm text-muted-foreground">No locked deposits found.</Card>
      ) : null}
      {selected ? (
        <RecoveryDepositDetail
          deposit={selected}
          busy={busy || awaitingStart}
          pendingAction={error || confirmed ? null : pending}
          startConfirmed={awaitingStart}
          onAction={action => recover(selected, action)}
        />
      ) : null}
      {!selectedResult && deposits.length > 0 ? (
        <Card className="overflow-hidden p-0!">
          <ul className="divide-y divide-border">
            {deposits.map(deposit => {
              const key = recoveryLockKey(deposit);
              return (
                <li key={key}>
                  <RecoveryDepositRow
                    id={`recovery-deposit-${key}`}
                    deposit={deposit}
                    startConfirmed={awaitingStartBlock(deposit, startBlocks?.[key])}
                    disabled={busy}
                    onSelect={() => showDeposit(key)}
                  />
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}
    </section>
  );
}
