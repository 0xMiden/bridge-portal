import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { withdrawalReady, type LockedDeposit, type RecoveryAction } from "../../../bridge/providers/epoch/recovery";
import { evmNetworks } from "../../../config/evm-networks";
import { compactTokenAmount } from "../../lib/token-amount";
import { NetworkLogo, TokenLogo } from "../AssetLogo";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { StatusIndicator } from "../ui/Status";

function useWithdrawalStatus(deposit: LockedDeposit) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const active = deposit.status !== 0;
  const ready = withdrawalReady(deposit, now);
  const waiting = active && !ready;
  const canWithdraw = ready && deposit.balance > 0n;

  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  }, [waiting]);

  if (!active) return { active, canWithdraw, label: "Withdrawal not started" };
  if (ready) return { active, canWithdraw, label: canWithdraw ? "Ready to withdraw" : "Withdrawal active" };
  const remaining = Math.max(0, Number(deposit.withdrawableAt) - now);
  const minutes = Math.floor(remaining / 60);
  const seconds = String(remaining % 60).padStart(2, "0");
  return { active, canWithdraw, label: `Available in ${minutes}m ${seconds}s` };
}

function DepositIdentity({ deposit, detail = false, status }: { deposit: LockedDeposit; detail?: boolean; status?: string }) {
  const { asset, balance } = deposit;
  const exactAmount = formatUnits(balance, asset.decimals);
  const displayAmount = compactTokenAmount(exactAmount);
  const Wrapper = detail ? "div" : "span";
  const Amount = detail ? "h2" : "span";

  return (
    <Wrapper className="flex min-w-0 items-center gap-3">
      <TokenLogo asset={asset} />
      <Wrapper className="grid min-w-0 gap-1">
        <Amount
          className={`${detail ? "text-xl" : "text-base"} leading-tight font-semibold tabular-nums wrap-anywhere`}
          title={displayAmount !== exactAmount ? `${exactAmount} ${asset.symbol}` : undefined}
        >
          {displayAmount} {asset.symbol}
        </Amount>
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <NetworkLogo network={asset.network} variant="selector" />
          <span>
            {evmNetworks[asset.network].name}
            {status ? <> <span aria-hidden="true">·</span> <span className="tabular-nums">{status}</span></> : null}
          </span>
        </span>
      </Wrapper>
    </Wrapper>
  );
}

export function RecoveryDepositRow({ id, deposit, disabled, onSelect }: {
  id: string;
  deposit: LockedDeposit;
  disabled: boolean;
  onSelect: () => void;
}) {
  const { label } = useWithdrawalStatus(deposit);

  return (
    <button
      id={id}
      type="button"
      className="flex min-h-16 w-full items-center justify-between gap-3 px-4 py-3 text-left transition
        hover:bg-surface-muted focus-visible:-outline-offset-2 disabled:opacity-60 mobile:px-3"
      disabled={disabled}
      onClick={onSelect}
    >
      <DepositIdentity deposit={deposit} status={label} />
      <ChevronRight size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  );
}

export function RecoveryDepositDetail({ deposit, busy, pending, onAction }: {
  deposit: LockedDeposit;
  busy: boolean;
  pending: boolean;
  onAction: (action: RecoveryAction) => Promise<void>;
}) {
  const { active, canWithdraw, label } = useWithdrawalStatus(deposit);
  const hasBalance = deposit.balance > 0n;
  return (
    <Card as="article" className="grid gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <DepositIdentity deposit={deposit} detail />
        {active ? (
          <StatusIndicator tone={canWithdraw ? "success" : "warning"} className="tabular-nums">{label}</StatusIndicator>
        ) : null}
      </div>
      {!hasBalance ? (
        <p className="text-sm text-muted-foreground">
          No locked funds remain.{active ? " Cancel the withdrawal to resume Epoch deposits." : ""}
        </p>
      ) : active ? (
        <p className="text-sm text-muted-foreground">
          {canWithdraw ? "Approve the withdrawal in your wallet. Your funds arrive when the transaction confirms." :
            <>Select <strong className="font-medium text-foreground">Withdraw to wallet</strong> when the timer ends.</>}
        </p>
      ) : (
        <>
          <div className="space-y-2 text-sm text-muted-foreground">
            <ol className="list-decimal space-y-2 pl-5">
              <li>
                Select <strong className="font-medium text-foreground">Start withdrawal</strong> and approve the transaction in your wallet.
                The 65-minute wait begins when it confirms.
              </li>
              <li>
                After the wait, select <strong className="font-medium text-foreground">Withdraw to wallet</strong> and approve the second transaction.
                Your funds arrive when it confirms.
              </li>
            </ol>
            <p>Starting a withdrawal pauses Epoch deposits for this wallet, token, and network until you withdraw or cancel.</p>
          </div>
          <Button variant="bridge" type="button" disabled={busy} onClick={() => onAction("start")}>Start withdrawal</Button>
        </>
      )}
      {canWithdraw ? (
        <Button variant="bridge" type="button" disabled={busy} onClick={() => onAction("withdraw")}>Withdraw to wallet</Button>
      ) : null}
      {active ? (
        <Button variant="secondary" className="justify-self-start" type="button" disabled={busy} onClick={() => onAction("cancel")}>
          Cancel withdrawal
        </Button>
      ) : null}
      {pending ? <p role="status" className="text-sm text-muted-foreground">Waiting for confirmation…</p> : null}
    </Card>
  );
}
