import { ArrowDownUp, RefreshCcw } from "lucide-react";
import dynamic from "next/dynamic";
import { useRef, type RefObject } from "react";
import { flowModes } from "../../../bridge/core/models";
import { reverseBridgeRoute } from "../../../bridge/core/routes";
import { bridgeProviders } from "../../../bridge/providers/registry";
import { WalletBrandIcon } from "../../../wallets/WalletBrandIcon";
import { gsap, useGSAP } from "../../lib/gsap";
import { EASE, motionMM } from "../../lib/motion";
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
      <button className="wallet-button wallet-pill" type="button" disabled>
        <span className="wallet-avatar"><span className="wallet-avatar-badge"><WalletBrandIcon size={11} /></span></span>
        <span className="wallet-pill-label">Loading</span>
      </button>
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
  const { route, amount } = draft;
  const { quote } = transfer;
  const reverse = reverseBridgeRoute(route);
  const unavailableReason = bridgeProviders[route.provider].unavailableReason;
  const cardRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);
  useGSAP(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    const root = cardRef.current;
    if (!root) return;
    motionMM(({ reduced }) => {
      if (reduced) return;
      gsap.fromTo(root.querySelectorAll(".swap-box > *"),
        { opacity: 0.6 }, { opacity: 1, duration: 0.36, ease: EASE.standard, overwrite: true });
    });
  }, { dependencies: [route.id], scope: cardRef });

  const selectRoute = (next: BridgeDraft["route"]) => onChange({ type: "route", route: next });
  return (
    <section className="swap-card" data-provider={route.provider} aria-label="Miden bridge" ref={cardRef}>
      {wallets.error ? <p className="form-error compact" role="alert">{wallets.error}</p> : null}
      <div className="mode-switch" role="group" aria-label="Cross-chain direction" data-active={route.mode}>
        {flowModes.map(mode => (
          <button key={mode} type="button" aria-pressed={mode === route.mode}
            disabled={mode !== route.mode && !reverse}
            title={mode !== route.mode && !reverse ? unavailableReason : undefined}
            onClick={() => onChange({ type: "mode", mode })}>
            {mode === "receive" ? "Deposit" : "Withdraw"}
          </button>
        ))}
      </div>
      <div className="swap-panels" ref={panelsRef}>
        {(["source", "destination"] as const).map(side => {
          const isSource = side === "source";
          const isMiden = route[side].kind === "miden";
          // Wallet keys preserve the mounted controls when the direction reverses.
          return (
            <div className="swap-box" key={isMiden ? "miden" : "evm"} data-side={side}>
              <div className="swap-box-head">
                <span>{isSource ? "From" : "To"}</span>
                <ChainSelect route={route} side={side} onSelectRoute={selectRoute} />
              </div>
              <div className="panel-wallet" data-wallet={isMiden ? "miden" : "evm"}>
                {isMiden ? <MidenWalletButton /> : <EvmWalletControl wallet={wallets.evm} onConnect={wallets.openEvmWallet} onError={wallets.setError} />}
              </div>
              {isSource ? (
                <label className="swap-box-amount">
                  <input aria-label="Amount" aria-invalid={Boolean(quote.amountError)}
                    aria-describedby={quote.amountError ? "amount-error" : undefined}
                    inputMode="decimal" placeholder="0" value={amount}
                    onChange={event => onChange({ type: "amount", amount: event.target.value })} />
                </label>
              ) : (
                <div className="readonly-amount swap-box-amount" aria-label="Expected received"><strong>{quote.received}</strong></div>
              )}
              <div className="swap-box-token"><TokenSelect route={route} side={side} onSelectRoute={selectRoute} /></div>
              <div className="swap-box-foot">
                <FiatAmount amount={isSource ? amount : quote.received} symbol={route[side].symbol} />
                <small className="balance-line">{isMiden ? <MidenBalance wallet={wallets.miden} /> : <EvmBalance wallet={wallets.evm} />}</small>
              </div>
              {isSource ? (
                <button className="swap-divider" type="button" aria-label="Reverse transfer direction" disabled={!reverse}
                  title={!reverse ? unavailableReason : "Reverse transfer direction"}
                  onClick={() => onChange({ type: "mode", mode: route.mode === "receive" ? "send" : "receive" })}>
                  <ArrowDownUp size={20} aria-hidden="true" />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      {quote.amountError ? <p id="amount-error" className="form-error" role="alert">{quote.amountError}</p>
        : transfer.error || quote.query.error ? <p className="form-error" role="alert">{transfer.error || errorMessage(quote.query.error)}</p> : null}
      {quote.balanceCap.enabled && !quote.balanceCap.checking && quote.balanceCap.status === "unavailable" && quote.validation.valid ? (
        <div id="balance-cap-status" className="balance-cap-status">
          <button type="button" className="balance-cap-retry" onClick={transfer.retryBalanceCap}>Retry balance check</button>
        </div>
      ) : null}
    </section>
  );
}

function EvmBalance({ wallet }: { wallet: BridgeWallets["evm"] }) {
  if (!wallet.connected) return null;
  if (wallet.balance.balance) return <>Available {wallet.balanceText}</>;
  if (wallet.balanceUnavailable) return <>Balance unavailable</>;
  return <><span aria-hidden="true">Available</span><span className="balance-placeholder" role="status"><span className="sr-only">Loading {wallet.token?.symbol} balance…</span></span></>;
}

function MidenBalance({ wallet }: { wallet: BridgeWallets["miden"] }) {
  if (!wallet.connected) return null;
  if (wallet.balance.balance) return (
    <>
      Available {wallet.balanceText}
      <button type="button" className="balance-refresh" onClick={() => void wallet.balance.refresh().catch(() => {})}
        disabled={wallet.balance.loading} aria-label="Refresh Miden balance" title="Refresh Miden balance">
        <RefreshCcw size={12} aria-hidden="true" />
      </button>
    </>
  );
  if (!wallet.balance.error) return <>Available Syncing…</>;
  return <button type="button" className="balance-show" onClick={() => void wallet.balance.show().catch(() => {})}>Balance unavailable · Retry</button>;
}
