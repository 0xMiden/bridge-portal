import { DetailsList } from "../ui/DetailsList";
import { FormAlert } from "../ui/Feedback";
import { Button } from "../ui/Button";
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
import { Dialog } from "../ui/Dialog";

export function TransferReview({ review, quote, walletsChanged, onCancel, onConfirm }: {
  review: ReviewedTransfer;
  quote: BridgeQuote;
  walletsChanged: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { route, amount, accounts } = review;
  const confirmRef = useRef<HTMLButtonElement>(null);
  const { fees, received, estimate } = quote;
  const total = fees.charging === "additional" && review.quote?.fee !== undefined && Number(review.quote.fee) > 0
    ? formatUnits(parseUnits(amount, route.source.decimals) + parseUnits(review.quote.fee, route.source.decimals), route.source.decimals) : undefined;

  const warning = <p className="preflight-note rounded-md bg-surface-muted p-3 text-xs text-muted-foreground">{estimate.warning}</p>;

  return (
    <Dialog label={`Review ${route.mode}`} onClose={onCancel} initialFocusRef={confirmRef}>
        <div className="preflight-head justify-between items-center gap-2 flex">
          <span className="preflight-head-title inline-flex items-center gap-2 font-bold">Review transfer<span className="preflight-testnet text-muted-foreground text-xs font-normal">{routeEnvironment(route) === "mainnet" ? "Mainnet" : "Testnet"}</span></span>
          <button type="button" className="preflight-close preflight-cancel grid size-11 place-items-center rounded-full bg-surface-muted text-muted-foreground" onClick={onCancel} aria-label="Cancel review"><X size={16} aria-hidden="true" /></button>
        </div>
        <div className="preflight-body min-h-0 space-y-3 overflow-y-auto overscroll-contain">
          <div className="preflight-amount my-3 flex flex-wrap items-baseline gap-3">
            <span className="preflight-quantity min-w-0 text-4xl font-medium wrap-anywhere">{amount} <span className="text-2xl text-muted-foreground">{route.source.symbol}</span></span>
            <FiatAmount amount={amount} symbol={route.source.symbol} size="review" />
          </div>
          <div className="preflight-path gap-7 mb-3 grid">
            {(["source", "destination"] as const).map(side => (
              <ReviewAccount key={side} side={side} asset={route[side]}
                account={route[side].kind === "miden" ? accounts.midenAccount : route[side].kind === "spl" ? accounts.sourceIdentity?.address ?? "" : accounts.evmAddress} />
            ))}
          </div>
          <DetailsList items={[
            (route.source.symbol !== route.destination.symbol || Number(amount) !== Number(received)) && {
              label: route.transport === "cctp-helper" ? "At least" : fees.estimated ? "Estimated received" : "You receive", value: `${received} ${route.destination.symbol}`,
            },
            (estimate.minReceived !== "Not quoted" && Number(estimate.minReceived) !== Number(received)) && {
              label: "Minimum received", value: `${estimate.minReceived} ${route.destination.symbol}`,
            },
            { label: "Provider", value: route.transport === "cctp-helper" ? "Circle · manual Arc execution" : bridgeProviders[route.provider].label },
            fees.showEta && { label: "Estimated time", value: estimate.eta },
            { label: "Network fee", value: quote.networkFee },
            review.quote?.kind === "cctp-helper" && { label: "Solana transaction fee", value: `${formatUnits(BigInt(review.quote.sourceFeeLamports), 9)} SOL` },
            review.quote?.kind === "cctp-helper" && { label: "Circle event-account rent", value: `${formatUnits(BigInt(review.quote.eventRentLamports), 9)} SOL (not reclaimed in v1)` },
            review.quote?.kind === "cctp-helper" && { label: "Arc execution", value: "Separate manual transaction and Arc gas required" },
            { label: fees.label, value: quote.fee },
            total !== undefined && { label: `Total ${route.source.symbol}`, value: `${total} ${route.source.symbol}` },
          ]} />
          {route.provider === "xreserve" && route.transport !== "cctp-helper" ? warning : null}
          {walletsChanged ? <FormAlert role="alert">Your connected wallet changed. Close this review and review the transfer again.</FormAlert> : null}
          {quote.capError ? <FormAlert role="alert">{quote.capError}</FormAlert> : null}
        </div>
        <div className="preflight-actions shrink-0 mobile:border-t mobile:border-border mobile:pt-3 mobile:pb-[max(12px,env(safe-area-inset-bottom))]">
          {route.transport === "cctp-helper" ? <div className="mb-3">{warning}</div> : null}
          <Button type="button" variant="primary" className="primary-button preflight-confirm" ref={confirmRef}
            disabled={walletsChanged || quote.capBlocked} onClick={onConfirm}>
            Confirm in wallet<ArrowRight size={18} aria-hidden="true" />
          </Button>
        </div>
    </Dialog>
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

  const addressButtonClasses = "min-h-11 min-w-11";
  return (
    <div className="preflight-stop relative flex items-start gap-3">
      {side === "source" && <span className="absolute top-8 -bottom-6 left-3 w-px bg-border" aria-hidden="true" />}
      <NetworkLogo network={asset.network} />
      <div className="min-w-0">
        <strong className="block text-sm font-medium leading-6">{networkLabels[asset.network]}</strong>
        <div className="preflight-address mt-1 flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
          <span>{side === "source" ? "From" : "To"}</span>
          <button type="button" id={`preflight-${side}-value`} className={`preflight-account max-w-full text-left text-foreground wrap-anywhere ${addressButtonClasses}`} title={account}
            aria-label={`${expanded ? "Hide" : "Show full"} ${side} address: ${account}`}
            aria-expanded={expanded} onClick={() => setExpanded(current => !current)}>
            {expanded ? account : shortAddress(account)}
          </button>
          {side === "destination" ? (
            <button type="button" className={`preflight-copy grid place-items-center ${addressButtonClasses}`} aria-label={copied ? "Destination copied" : "Copy destination"} onClick={copyAddress}>
              {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
