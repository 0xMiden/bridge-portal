"use client";

import { useAppKit, useAppKitAccount, useAppKitProvider, useDisconnect } from "@reown/appkit/react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, RefreshCcw, Wallet } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getAddress, type Address } from "viem";
import { assetKey } from "../../../bridge/core/assets";
import { recoveryAssets, readLockedDeposit, type LockedDeposit, type RecoveryAction } from "../../../bridge/providers/epoch/recovery";
import { executeRecovery } from "../../../bridge/providers/epoch/recovery-execute";
import { useBalanceStore } from "../../../bridge/BalanceProvider";
import { evmNetworks } from "../../../config/evm-networks";
import type { EvmProvider } from "../../../wallets/evm/evm-wallet";
import { shortAddress } from "../../../wallets/identity";
import { errorMessage } from "../../lib/wallet-errors";
import { useBridgeEnvironment, useLockNetworkSelection, useNetworkSelectionLocked } from "../NetworkProvider";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { FormAlert } from "../ui/Feedback";
import { RecoveryDepositDetail, RecoveryDepositRow } from "./RecoveryDeposit";

const confirmationMessages = {
  start: "Withdrawal started.",
  cancel: "Withdrawal canceled.",
  withdraw: "Withdrawal complete.",
} satisfies Record<RecoveryAction, string>;

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
      setError(errorMessage(cause));
    }
  }

  async function disconnectWallet() {
    setError("");
    setDisconnecting(true);
    try {
      await disconnect({ namespace: "eip155" });
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <section aria-labelledby="recovery-title" className="mx-auto mt-6 grid w-full max-w-137 gap-4 pb-10 mobile:mt-4">
      <h1 id="recovery-title" className="text-2xl font-semibold tracking-tight">Recover Epoch deposits</h1>
      <Card className="grid gap-3">
        {sponsor ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-md bg-accent-soft text-accent-foreground">
                <Wallet size={18} aria-hidden="true" />
              </span>
              <div>
                <p className="text-xs text-muted-foreground">Deposit wallet</p>
                <p className="font-mono text-sm font-medium" title={sponsor}>{shortAddress(sponsor)}</p>
              </div>
            </div>
            <Button variant="secondary" type="button" disabled={selectionLocked || disconnecting} onClick={disconnectWallet}>
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </Button>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">Connect the EVM wallet you used to deposit.</p>
            <Button variant="bridge" type="button" disabled={disconnecting} onClick={connect}>
              <Wallet size={16} aria-hidden="true" />Connect wallet
            </Button>
          </>
        )}
        {error ? <FormAlert className="mt-0!">{error}</FormAlert> : null}
      </Card>
      {sponsor ? <RecoveryBalances key={`${environment}:${sponsor}`} sponsor={sponsor} disconnecting={disconnecting} /> : null}
    </section>
  );
}

function RecoveryBalances({ sponsor, disconnecting }: { sponsor: Address; disconnecting: boolean }) {
  const environment = useBridgeEnvironment();
  const lockSelection = useLockNetworkSelection();
  const { walletProvider } = useAppKitProvider<EvmProvider>("eip155");
  const queryClient = useQueryClient();
  const balances = useBalanceStore();
  const [selectedKey, setSelectedKey] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const backButton = useRef<HTMLButtonElement>(null);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const returnFocus = useRef("");
  const assets = recoveryAssets(environment);
  const results = useQueries({ queries: assets.map(asset => ({
    queryKey: ["compact-recovery", environment, sponsor, assetKey(asset)],
    queryFn: () => readLockedDeposit(asset, environment, sponsor),
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: true,
  })) });
  const selectedIndex = selectedKey ? assets.findIndex(asset => assetKey(asset) === selectedKey) : -1;
  const selectedResult = selectedIndex < 0 ? undefined : results[selectedIndex];
  const selected = selectedResult?.isError ? undefined : selectedResult?.data;
  const fetching = selectedResult?.isFetching ?? results.some(result => result.isFetching);
  const checking = fetching || (selectedResult?.isPending ?? results.some(result => result.isPending));
  const busy = disconnecting || pending;
  const deposits = results.flatMap(result => result.isError || !result.data ? [] : [result.data])
    .filter(deposit => deposit.balance > 0n || deposit.status !== 0);
  const failed = assets.filter((_, index) => (!selectedResult || index === selectedIndex) && results[index].isError);
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
    setNotice("");
  }

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["compact-recovery", environment, sponsor] });
  }

  async function recover(deposit: LockedDeposit, action: RecoveryAction) {
    setError("");
    setNotice("");
    setPending(true);
    const unlock = lockSelection();
    try {
      if (!walletProvider) throw new Error("Connect your EVM wallet first.");
      await executeRecovery(deposit, action, sponsor, environment, walletProvider);
      setNotice(confirmationMessages[action]);
      await queryClient.invalidateQueries(balances.evmQuery(sponsor, deposit.asset));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      try {
        await refresh();
      } finally {
        setPending(false);
        unlock();
      }
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
            disabled={pending}
          >
            <ArrowLeft size={16} className="shrink-0" aria-hidden="true" />All locked deposits
          </button>
        ) : (
          <h2 ref={listHeading} tabIndex={-1} className="text-base font-semibold">Locked deposits</h2>
        )}
        <Button variant="toolbar" type="button" disabled={fetching || busy} onClick={() => selectedResult ? selectedResult.refetch() : refresh()}>
          <span className={fetching ? "motion-safe:animate-spin" : undefined}>
            <RefreshCcw size={16} aria-hidden="true" />
          </span>
          Refresh
        </Button>
      </div>
      {failed.length > 0 ? (
        <FormAlert className="mt-0!">
          Could not check deposits for {failed.map(asset => `${asset.symbol} on ${evmNetworks[asset.network].name}`).join(", ")}.
        </FormAlert>
      ) : null}
      {error ? <FormAlert className="mt-0!">{error}</FormAlert> : null}
      {notice ? (
        <p role="status" className="rounded-md bg-success-soft p-3 text-sm text-success-foreground">{notice}</p>
      ) : null}
      {checking ? (
        <p role="status" className={hasVisibleDeposit ? "sr-only" : "text-sm text-muted-foreground"}>
          {selectedResult ? "Checking deposit…" : "Checking deposits…"}
        </p>
      ) : null}
      {!selectedResult && !checking && !failed.length && !deposits.length ? (
        <Card variant="empty" role="status" className="text-sm text-muted-foreground">No locked deposits found.</Card>
      ) : null}
      {selected ? (
        <RecoveryDepositDetail
          deposit={selected}
          busy={busy}
          pending={pending && !error && !notice}
          onAction={action => recover(selected, action)}
        />
      ) : null}
      {!selectedResult && deposits.length > 0 ? (
        <Card className="overflow-hidden p-0!">
          <ul className="divide-y divide-border">
            {deposits.map(deposit => {
              const key = assetKey(deposit.asset);
              return (
                <li key={key}>
                  <RecoveryDepositRow
                    id={`recovery-deposit-${key}`}
                    deposit={deposit}
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
