import { RefreshCcw } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { bridgeProviders } from "../../../bridge/providers/registry";
import { InfoTip } from "../InfoTip";
import { ProviderOptions } from "../ProviderOptions";
import type { BridgeDraft, DraftAction } from "./use-bridge-draft";
import type { BridgeTransfer } from "./use-bridge-transfer";

export function TransferRouteCard({ draft, transfer, onChange, onPrimaryAction, children }: {
  draft: BridgeDraft;
  transfer: Pick<BridgeTransfer, "quote" | "cta" | "isSubmitting">;
  onChange: (action: DraftAction) => void;
  onPrimaryAction: () => void;
  children?: ReactNode;
}) {
  const { route, amount, providerSelection, routeMenuOpen } = draft;
  const { quote, cta, isSubmitting } = transfer;
  const triggerRef = useRef<HTMLButtonElement>(null);
  function closeMenu() {
    onChange({ type: "route-menu", open: false });
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  return (
    <section className="transfer-route-card" data-provider={route.provider} data-has-amount={quote.validation.valid} aria-label="Transfer route">
      <div className="transfer-route-details" hidden={!quote.validation.valid}>
        <h2>Your route</h2>
        <div className="transfer-route-heading">
          <div className="provider-identity">
            <strong className="selected-provider">{bridgeProviders[route.provider].label}</strong>
            <span className="route-pill selection-badge">{providerSelection === "automatic" ? "Automatic" : "Manual"}</span>
          </div>
          <button className="route-trigger" type="button" ref={triggerRef}
            aria-expanded={routeMenuOpen && quote.validation.valid} aria-controls="bridge-route-options"
            onClick={() => onChange({ type: "route-menu", open: !routeMenuOpen })}>
            {routeMenuOpen ? "Close" : "Change"}
          </button>
        </div>
        <div className="route-received" aria-label="Route received amount">{quote.received} <span>{route.destination.symbol}</span></div>
        <div id="bridge-route-options" className="transfer-route-options" role="group" aria-label="Compatible providers"
          hidden={!routeMenuOpen} onKeyDown={event => {
            if (event.key === "Escape") { event.preventDefault(); closeMenu(); }
          }}>
          <ProviderOptions route={route} amount={amount} received={quote.received} fee={quote.fee} onSelect={next => {
            onChange({ type: "route", route: next, manual: true });
            closeMenu();
          }} />
        </div>
        <div className="route-footer">
          <div className="quote-summary" aria-label="Route quote">
            {quote.fees.charging === "additional" || quote.fees.charging === "deducted" ? <div><span>{quote.fees.label}</span><strong>{quote.fee}</strong></div> : null}
            {quote.fees.showEta ? <div><span>ETA</span><strong>{quote.estimate.eta}</strong></div> : null}
            <div><span>Network fee</span><strong>{quote.networkFee}</strong></div>
          </div>
          <div className="route-context">
            <span>{providerSelection === "manual" ? "Selected by you" : "Selected automatically"}</span>
            <InfoTip label={quote.estimate.warning} />
          </div>
        </div>
      </div>
      <div className="primary-action-dock">
        <button className="primary-button" type="button" onClick={onPrimaryAction}
          disabled={cta.disabled || Boolean(quote.validation.error) || (cta.action === "review" && quote.capBlocked)}>
          {cta.action === "review" ? "Review transfer" : cta.label}
          {isSubmitting ? <RefreshCcw size={18} className="animate-spin" aria-hidden="true" /> : null}
        </button>
      </div>
      {children}
    </section>
  );
}
