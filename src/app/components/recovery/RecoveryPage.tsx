"use client";

import { useAppKit, useAppKitAccount, useAppKitProvider, useDisconnect } from "@reown/appkit/react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { RefreshCcw, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { formatUnits, getAddress, type Address } from "viem";
import { assetKey } from "../../../bridge/core/assets";
import { recoveryAssets, readLockedDeposit, withdrawalReady, type LockedDeposit, type RecoveryAction } from "../../../bridge/providers/epoch/recovery";
import { executeRecovery } from "../../../bridge/providers/epoch/recovery-execute";
import { useBalanceStore } from "../../../bridge/BalanceProvider";
import { evmNetworks } from "../../../config/evm-networks";
import type { EvmProvider } from "../../../wallets/evm/evm-wallet";
import { shortAddress } from "../../../wallets/identity";
import { compactTokenAmount } from "../../lib/token-amount";
import { errorMessage } from "../../lib/wallet-errors";
import { NetworkLogo, TokenLogo } from "../AssetLogo";
import { useBridgeEnvironment, useLockNetworkSelection, useNetworkSelectionLocked } from "../NetworkProvider";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { FormAlert } from "../ui/Feedback";
import { StatusIndicator } from "../ui/Status";

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
      <h1 id="recovery-title" className="text-2xl font-semibold tracking-tight">Recover Fast deposits</h1>
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
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const assets = recoveryAssets(environment);
  const results = useQueries({ queries: assets.map(asset => ({
    queryKey: ["compact-recovery", environment, sponsor, assetKey(asset)],
    queryFn: () => readLockedDeposit(asset, environment, sponsor),
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: true,
  })) });
  const loading = results.some(result => result.isFetching);
  const busy = disconnecting || Boolean(pending);
  const deposits = results.flatMap(result => result.isError || !result.data ? [] : [result.data])
    .filter(deposit => deposit.balance > 0n || deposit.status !== 0);
  const failed = assets.filter((_, index) => results[index].isError);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["compact-recovery", environment, sponsor] });
  }

  async function recover(deposit: LockedDeposit, action: RecoveryAction) {
    setError("");
    setNotice("");
    setPending(assetKey(deposit.asset));
    const unlock = lockSelection();
    try {
      if (!walletProvider) throw new Error("Connect your EVM wallet first.");
      await executeRecovery(deposit, action, sponsor, environment, walletProvider);
      setNotice(confirmationMessages[action]);
      await queryClient.invalidateQueries(balances.evmQuery(sponsor, deposit.asset));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      await refresh();
      setPending("");
      unlock();
    }
  }

  return (
    <section aria-labelledby="locked-deposits" className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="locked-deposits" className="text-base font-semibold">Locked deposits</h2>
        <Button variant="toolbar" type="button" disabled={loading || busy} onClick={refresh}>
          <span className={loading ? "motion-safe:animate-spin" : undefined}>
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
      {loading ? (
        <p role="status" className={deposits.length ? "sr-only" : "text-sm text-muted-foreground"}>Checking deposits…</p>
      ) : null}
      {!loading && !failed.length && !deposits.length ? (
        <Card variant="empty" role="status" className="text-sm text-muted-foreground">No locked deposits found.</Card>
      ) : null}
      {deposits.map(deposit => (
        <RecoveryDeposit
          key={assetKey(deposit.asset)}
          deposit={deposit}
          busy={busy}
          pending={pending === assetKey(deposit.asset)}
          onAction={action => recover(deposit, action)}
        />
      ))}
    </section>
  );
}

function RecoveryDeposit({ deposit, busy, pending, onAction }: {
  deposit: LockedDeposit;
  busy: boolean;
  pending: boolean;
  onAction: (action: RecoveryAction) => Promise<void>;
}) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (deposit.status === 0) return;
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  }, [deposit.status]);
  const { asset, balance, status } = deposit;
  const exactAmount = formatUnits(balance, asset.decimals);
  const displayAmount = compactTokenAmount(exactAmount);
  const active = status !== 0;
  const hasBalance = balance > 0n;
  const ready = withdrawalReady(deposit, now);
  const canWithdraw = ready && hasBalance;
  const remaining = Math.max(0, Number(deposit.withdrawableAt) - now);
  const minutes = Math.floor(remaining / 60);
  const seconds = String(remaining % 60).padStart(2, "0");
  const withdrawalLabel = ready
    ? (hasBalance ? "Ready to withdraw" : "Withdrawal active")
    : `Available in ${minutes}m ${seconds}s`;

  return (
    <Card as="article" className="grid gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <TokenLogo asset={asset} />
          <div className="grid min-w-0 gap-1">
            <h3
              className="text-xl leading-tight font-semibold tabular-nums wrap-anywhere"
              title={displayAmount !== exactAmount ? `${exactAmount} ${asset.symbol}` : undefined}
            >
              {displayAmount} {asset.symbol}
            </h3>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <NetworkLogo network={asset.network} variant="selector" />
              {evmNetworks[asset.network].name}
            </p>
          </div>
        </div>
        {active ? (
          <StatusIndicator tone={canWithdraw ? "success" : "warning"} className="tabular-nums">{withdrawalLabel}</StatusIndicator>
        ) : null}
      </div>
      {active ? (
        <div className="grid grid-cols-2 gap-2">
          <Button variant={canWithdraw ? "bridge" : "secondary"} type="button" disabled={busy || !canWithdraw} onClick={() => onAction("withdraw")}>
            Withdraw to wallet
          </Button>
          <Button variant="secondary" type="button" disabled={busy} onClick={() => onAction("cancel")}>Cancel withdrawal</Button>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            You can withdraw 65 minutes after starting. Fast deposits for this token pause until you withdraw or cancel.
          </p>
          <Button variant="bridge" type="button" disabled={busy || !hasBalance} onClick={() => onAction("start")}>Start withdrawal</Button>
        </>
      )}
      {pending ? <p role="status" className="text-sm text-muted-foreground">Waiting for confirmation…</p> : null}
    </Card>
  );
}
