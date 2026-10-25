import { ArrowRight, Check, Copy, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import type { BridgeAsset } from "../../../bridge/core/assets";
import { routeEnvironment } from "../../../bridge/core/routes";
import { bridgeProviders } from "../../../bridge/providers/registry";
import { shortAddress } from "../../../wallets/identity";
import { networkLabels } from "../../lib/bridge-presentation";
import { NetworkLogo } from "../AssetLogo";
import { FiatAmount } from "../FiatAmount";
import type { BridgeQuote } from "./use-bridge-quote";
import type { ReviewedTransfer } from "./use-bridge-transfer";
import { useReviewDialog } from "./use-review-dialog";

export function TransferReview({ review, quote, walletsChanged, onCancel, onConfirm }: {
  review: ReviewedTransfer;
  quote: BridgeQuote;
  walletsChanged: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { route, amount, accounts } = review;
  const { confirmRef, onKeyDown } = useReviewDialog(onCancel);
  const { fees, received, estimate } = quote;
  const total = fees.charging === "additional" && review.quote?.fee !== undefined && Number(review.quote.fee) > 0
    ? formatUnits(parseUnits(amount, route.source.decimals) + parseUnits(review.quote.fee, route.source.decimals), route.source.decimals) : undefined;

  return (
    <div className="preflight-overlay" role="dialog" aria-modal="true" aria-label={`Review ${route.mode}`}
      onKeyDown={onKeyDown} onClick={event => { if (event.target === event.currentTarget) onCancel(); }}>
      <div className="preflight-panel">
        <div className="preflight-head">
          <span className="preflight-head-title">Review transfer<span className="preflight-testnet">{routeEnvironment(route) === "mainnet" ? "Mainnet" : "Testnet"}</span></span>
          <button type="button" className="preflight-close preflight-cancel" onClick={onCancel} aria-label="Cancel review"><X size={16} aria-hidden="true" /></button>
        </div>
        <div className="preflight-body">
          <div className="preflight-amount">
            <span className="preflight-quantity">{amount} <span>{route.source.symbol}</span></span>
            <FiatAmount amount={amount} symbol={route.source.symbol} />
          </div>
          <div className="preflight-path">
            {(["source", "destination"] as const).map(side => (
              <ReviewAccount key={side} side={side} asset={route[side]}
                account={route[side].kind === "miden" ? accounts.midenAccount : accounts.evmAddress} />
            ))}
          </div>
          <dl className="preflight-rows">
            {route.source.symbol !== route.destination.symbol || Number(amount) !== Number(received) ? (
              <div><dt>{fees.estimated ? "Estimated received" : "You receive"}</dt><dd>{received} {route.destination.symbol}</dd></div>
            ) : null}
            {estimate.minReceived !== "Not quoted" && Number(estimate.minReceived) !== Number(received) ? (
              <div><dt>Minimum received</dt><dd>{estimate.minReceived} {route.destination.symbol}</dd></div>
            ) : null}
            <div><dt>Provider</dt><dd>{bridgeProviders[route.provider].label}</dd></div>
            {fees.showEta ? <div><dt>Estimated time</dt><dd>{estimate.eta}</dd></div> : null}
            <div><dt>Network fee</dt><dd>{quote.networkFee}</dd></div>
            <div><dt>{fees.label}</dt><dd>{quote.fee}</dd></div>
            {total ? <div><dt>Total {route.source.symbol}</dt><dd>{total} {route.source.symbol}</dd></div> : null}
          </dl>
          {route.provider === "xreserve" ? <p className="preflight-note">{estimate.warning}</p> : null}
          {walletsChanged ? <p className="form-error" role="alert">Your connected wallet changed. Close this review and review the transfer again.</p> : null}
          {quote.capError ? <p className="form-error" role="alert">{quote.capError}</p> : null}
        </div>
        <div className="preflight-actions">
          <button type="button" className="primary-button preflight-confirm" ref={confirmRef}
            disabled={walletsChanged || quote.capBlocked} onClick={onConfirm}>
            Confirm in wallet<ArrowRight size={18} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

function ReviewAccount({ side, asset, account }: { side: "source" | "destination"; asset: BridgeAsset; account: string }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(account);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2_000);
    } catch {
      // Clipboard access may be blocked; keep the action available for retry.
    }
  }

  return (
    <div className="preflight-stop">
      <NetworkLogo network={asset.network} />
      <div className="preflight-stop-content">
        <strong>{networkLabels[asset.network]}</strong>
        <div className="preflight-address">
          <span>{side === "source" ? "From" : "To"}</span>
          <button type="button" id={`preflight-${side}-value`} className="preflight-account" title={account}
            aria-label={`${expanded ? "Hide" : "Show full"} ${side} address: ${account}`}
            aria-expanded={expanded} onClick={() => setExpanded(current => !current)}>
            {expanded ? account : shortAddress(account)}
          </button>
          {side === "destination" ? (
            <button type="button" className="preflight-copy" aria-label={copied ? "Destination copied" : "Copy destination"} onClick={copyAddress}>
              {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
