import { Card } from "../ui/Card";
import { WalletButton } from "../../../wallets/WalletMenu";
import { FormAlert } from "../ui/Feedback";
import { ArrowDownUp, RefreshCcw } from "lucide-react";
import dynamic from "next/dynamic";
import { useLayoutEffect, useRef, type RefObject } from "react";
import { flowModes } from "../../../bridge/core/models";
import { reverseBridgeRoute } from "../../../bridge/core/routes";
import { bridgeProviders } from "../../../bridge/providers/registry";
import { animateWithMotionPreference, standardEase } from "../../lib/motion";
import { errorMessage } from "../../lib/wallet-errors";
import { ChainSelect } from "../ChainSelect";
import { FiatAmount } from "../FiatAmount";
import { TokenSelect } from "../TokenSelect";
import { EvmWalletControl } from "./EvmWalletControl";
import type { BridgeDraft, DraftAction } from "./use-bridge-draft";
import type { BridgeTransfer } from "./use-bridge-transfer";
import type { BridgeWallets } from "./use-bridge-wallets";

const MidenWalletButton = dynamic(
  () => import("../../../wallets/miden/MidenWalletButton").then(mod => mod.MidenWalletButton),
  {
    ssr: false,
    loading: () => (
      <WalletButton type="button" showChevron={false} disabled>
        <span className="truncate">Loading</span>
      </WalletButton>
    ),
  },
);

export function SwapPanels({ draft, wallets, transfer, panelsRef, onChange }: {
  draft: BridgeDraft;
  wallets: BridgeWallets;
  transfer: Pick<BridgeTransfer, "quote" | "error" | "retryBalanceCap">;
  panelsRef: RefObject<HTMLDivElement | null>;
  onChange: (action: DraftAction) => void;
}) {
  const { route } = draft;
  const { quote } = transfer;
  const reverse = reverseBridgeRoute(route);
  const unavailableReason = bridgeProviders[route.provider].unavailableReason;
  const cardRef = useRef<HTMLElement>(null);
  const previousRoute = useRef(route.id);
  useLayoutEffect(() => {
    if (previousRoute.current === route.id) return;
    previousRoute.current = route.id;
    const root = cardRef.current;
    if (!root) return;
    return animateWithMotionPreference(() => Array.from(root.querySelectorAll(".swap-box > *"), element =>
      element.animate([{ opacity: 0.6 }, { opacity: 1 }], { duration: 360, easing: standardEase }),
    ));
  }, [route.id]);

  return (
    <Card className="swap-card" data-provider={route.provider} aria-label="Miden bridge" ref={cardRef}>
      {wallets.error ? <FormAlert compact role="alert">{wallets.error}</FormAlert> : null}
      <div className="mode-switch grid grid-cols-2 gap-2 rounded-xl border border-border bg-field p-1" role="group" aria-label="Cross-chain direction" data-active={route.mode}>
        {flowModes.map(mode => (
          <button className="min-h-10 rounded-[8px] text-sm font-medium text-muted-foreground transition hover:text-foreground
            aria-pressed:bg-surface aria-pressed:font-semibold aria-pressed:text-foreground aria-pressed:shadow-[inset_0_0_0_1px_var(--border)]" key={mode} type="button" aria-pressed={mode === route.mode}
            disabled={mode !== route.mode && !reverse}
            title={mode !== route.mode && !reverse ? unavailableReason : undefined}
            onClick={() => onChange({ type: "mode", mode })}>
            {mode === "receive" ? "Deposit" : "Withdraw"}
          </button>
        ))}
      </div>
      <div className="swap-panels relative mt-4 grid gap-4" ref={panelsRef}>
        {(["source", "destination"] as const).map(side => (
          <TransferPanel key={route[side].kind === "miden" ? "miden" : "evm"} side={side} draft={draft} wallets={wallets} quote={quote} onChange={onChange} />
        ))}
      </div>
      {quote.amountError ? <FormAlert id="amount-error">{quote.amountError}</FormAlert>
        : transfer.error || quote.query.error ? <FormAlert role="alert">{transfer.error || errorMessage(quote.query.error)}</FormAlert> : null}
      {quote.balanceCap.enabled && !quote.balanceCap.checking && quote.balanceCap.status === "unavailable" && quote.validation.valid ? (
        <div id="balance-cap-status" className="mt-4 mx-0.5 text-sm text-muted-foreground wrap-anywhere">
          <button type="button" className="mt-1 block min-h-11 p-0 font-semibold text-foreground underline underline-offset-3 hover:text-accent-foreground" onClick={transfer.retryBalanceCap}>Retry balance check</button>
        </div>
      ) : null}
    </Card>
  );
}

function TransferPanel({ side, draft, wallets, quote, onChange }: {
  side: "source" | "destination";
  draft: BridgeDraft;
  wallets: BridgeWallets;
  quote: BridgeTransfer["quote"];
  onChange: (action: DraftAction) => void;
}) {
  const { route, amount } = draft;
  const isSource = side === "source";
  const isMiden = route[side].kind === "miden";
  const reverse = reverseBridgeRoute(route);
  const unavailableReason = bridgeProviders[route.provider].unavailableReason;
  const selectRoute = (next: BridgeDraft["route"]) => onChange({ type: "route", route: next });
  const amountClasses = "block w-full min-w-0 bg-transparent text-4xl font-medium outline-none mobile:text-3xl";
  return (
    <div className="swap-box relative space-y-2 rounded-[20px] border border-border bg-field p-3" data-side={side}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="swap-box-head flex min-w-0 flex-1 basis-32 flex-wrap items-center gap-1 text-xs text-muted-foreground">
          <span>{isSource ? "From" : "To"}</span>
          <ChainSelect route={route} side={side} onSelectRoute={selectRoute} />
        </div>
        <div className="panel-wallet ml-auto min-w-0 max-w-43 flex-1 basis-36" data-wallet={isMiden ? "miden" : "evm"}>
          {isMiden ? <MidenWalletButton /> : <EvmWalletControl wallet={wallets.evm} onConnect={wallets.openEvmWallet} onError={wallets.setError} />}
        </div>
      </div>
      <div className="flex items-center gap-3">
        {isSource ? (
          <label className="min-w-0 flex-1">
            <input className={amountClasses} aria-label="Amount" aria-invalid={Boolean(quote.amountError)}
              aria-describedby={quote.amountError ? "amount-error" : undefined}
              inputMode="decimal" placeholder="0" value={amount}
              onChange={event => onChange({ type: "amount", amount: event.target.value })} />
          </label>
        ) : (
          <div className="readonly-amount min-w-0 flex-1" aria-label="Expected received"><strong className={amountClasses}>{quote.received}</strong></div>
        )}
        <TokenSelect route={route} side={side} onSelectRoute={selectRoute} />
      </div>
      <div className="flex min-h-5 items-center justify-between gap-2">
        <FiatAmount amount={isSource ? amount : quote.received} symbol={route[side].symbol} />
        <small className="balance-line flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">{isMiden ? <MidenBalance wallet={wallets.miden} /> : <EvmBalance wallet={wallets.evm} />}</small>
      </div>
      {isSource ? (
        <button className="swap-divider absolute -bottom-8 left-1/2 z-2 grid size-11 -translate-x-1/2 place-items-center rounded-xl border border-border bg-surface
          enabled:hover:border-accent enabled:hover:text-accent-foreground disabled:text-muted-foreground" type="button" aria-label="Reverse transfer direction" disabled={!reverse}
          title={!reverse ? unavailableReason : "Reverse transfer direction"}
          onClick={() => onChange({ type: "mode", mode: route.mode === "receive" ? "send" : "receive" })}>
          <ArrowDownUp size={20} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

function EvmBalance({ wallet }: { wallet: BridgeWallets["evm"] }) {
  if (!wallet.connected) return null;
  if (wallet.balance.balance) return <>Available {wallet.balanceText}</>;
  if (wallet.balanceUnavailable) return <>Balance unavailable</>;
  return <><span aria-hidden="true">Available</span><span className="h-3 w-12 rounded bg-border-strong" role="status"><span className="sr-only">Loading {wallet.token?.symbol} balance…</span></span></>;
}

function MidenBalance({ wallet }: { wallet: BridgeWallets["miden"] }) {
  if (!wallet.connected) return null;
  if (wallet.balance.balance) return (
    <>
      Available {wallet.balanceText}
      <button type="button" className="-my-3 grid size-11 shrink-0 place-items-center rounded-md hover:text-foreground" onClick={() => void wallet.balance.refresh().catch(() => {})}
        disabled={wallet.balance.loading} aria-label="Refresh Miden balance" title="Refresh Miden balance">
        <RefreshCcw size={12} aria-hidden="true" />
      </button>
    </>
  );
  if (!wallet.balance.error) return <>Available Syncing…</>;
  return <button type="button" className="min-h-11 rounded-md hover:bg-surface-muted" onClick={() => void wallet.balance.show().catch(() => {})}>Balance unavailable · Retry</button>;
}
