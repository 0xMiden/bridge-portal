"use client";

import { useAppKit, useAppKitAccount, useAppKitProvider } from "@reown/appkit/react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { formatUnits, getAddress, type Address } from "viem";
import { assetKey } from "../../../bridge/core/assets";
import { recoveryAssets, readLockedDeposit, withdrawalReady, type LockedDeposit, type RecoveryAction } from "../../../bridge/providers/epoch/recovery";
import { executeRecovery } from "../../../bridge/providers/epoch/recovery-execute";
import { useBalanceStore } from "../../../bridge/BalanceProvider";
import { evmNetworks } from "../../../config/evm-networks";
import type { EvmProvider } from "../../../wallets/evm/evm-wallet";
import { shortAddress } from "../../../wallets/identity";
import { errorMessage } from "../../lib/wallet-errors";
import { useBridgeEnvironment, useLockNetworkSelection } from "../NetworkProvider";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { FormAlert } from "../ui/Feedback";

export function RecoveryPage() {
  const environment = useBridgeEnvironment();
  const { address, isConnected } = useAppKitAccount({ namespace: "eip155" });
  const { open } = useAppKit();
  const [error, setError] = useState("");
  const sponsor = isConnected && address ? getAddress(address) : undefined;

  async function connect() {
    try { await open({ namespace: "eip155", view: "Connect" }); }
    catch (cause) { setError(errorMessage(cause)); }
  }

  return (
    <section className="mx-auto my-10 grid w-full max-w-2xl gap-5 mobile:my-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Recover Fast deposits</h1>
        <p className="text-sm text-muted-foreground">Find tokens locked in The Compact on {environment}, including deposits made in Bread or another app.</p>
      </div>
      <Card className="space-y-3">
        <p className="text-sm wrap-anywhere">{sponsor ? `Connected wallet: ${shortAddress(sponsor)}` : "Connect the EVM wallet that made the deposit."}</p>
        <Button variant="secondary" type="button" onClick={connect}>{sponsor ? "Change wallet" : "Connect wallet"}</Button>
        {error ? <FormAlert>{error}</FormAlert> : null}
      </Card>
      {sponsor ? <RecoveryBalances key={`${environment}:${sponsor}`} sponsor={sponsor} /> : null}
    </section>
  );
}

function RecoveryBalances({ sponsor }: { sponsor: Address }) {
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
      setNotice("Transaction confirmed. Balances have been refreshed.");
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
    <>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">Locked deposits and withdrawals</h2>
        <Button variant="secondary" type="button" disabled={loading || Boolean(pending)} onClick={refresh}>{loading ? "Scanning…" : "Refresh"}</Button>
      </div>
      <p className="text-sm text-muted-foreground">Starting withdrawal begins a 65-minute wait. Fast bridge-in for that token and wallet is blocked until you cancel or complete withdrawal. Recovered tokens return to this wallet.</p>
      {failed.length > 0 ? <FormAlert>Could not read {failed.map(asset => `${asset.symbol} on ${evmNetworks[asset.network].name}`).join(", ")}. These balances are not known. Select Refresh to retry.</FormAlert> : null}
      {error ? <FormAlert>{error}</FormAlert> : null}
      {notice ? <p role="status" className="text-sm">{notice}</p> : null}
      {loading ? <p role="status" className="text-sm text-muted-foreground">Checking on-chain balances…</p> : null}
      {!loading && !failed.length && !deposits.length ? <Card><p>No locked Fast deposits found for this wallet on {environment}.</p></Card> : null}
      {deposits.map(deposit => <RecoveryDeposit key={assetKey(deposit.asset)} deposit={deposit}
        busy={Boolean(pending)} pending={pending === assetKey(deposit.asset)} onAction={action => recover(deposit, action)} />)}
    </>
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
  const ready = withdrawalReady(deposit, now);
  const remaining = Math.max(0, Number(deposit.withdrawableAt) - now);
  const minutes = Math.floor(remaining / 60);
  const seconds = String(remaining % 60).padStart(2, "0");
  const active = deposit.status !== 0;

  return (
    <Card variant="receipt" className="space-y-3">
      <h3 className="font-semibold wrap-anywhere">{formatUnits(deposit.balance, deposit.asset.decimals)} {deposit.asset.symbol} locked on {evmNetworks[deposit.asset.network].name}</h3>
      {active ? <p className="text-sm text-muted-foreground">{ready ? "Ready to withdraw" : `Withdrawal available in ${minutes}:${seconds}`}</p> : null}
      <div className="flex flex-wrap gap-2">
        {!active ? <Button variant="secondary" type="button" disabled={busy || deposit.balance === 0n} onClick={() => onAction("start")}>Start withdrawal</Button> : null}
        {active ? <>
          <Button variant="secondary" type="button" disabled={busy || !ready || deposit.balance === 0n} onClick={() => onAction("withdraw")}>Withdraw to wallet</Button>
          <Button variant="secondary" type="button" disabled={busy} onClick={() => onAction("cancel")}>Disable withdrawal to bridge again</Button>
        </> : null}
      </div>
      {pending ? <p role="status" className="text-sm text-muted-foreground">Complete the request in your wallet. Then wait for confirmation.</p> : null}
    </Card>
  );
}
