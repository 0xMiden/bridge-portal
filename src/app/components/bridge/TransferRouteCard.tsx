import { Card } from "../ui/Card";
import { DetailsList } from "../ui/DetailsList";
import { Button } from "../ui/Button";
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
    <Card plain={!quote.validation.valid} className="transfer-route-card" data-provider={route.provider} data-has-amount={quote.validation.valid} aria-label="Transfer route">
      <div className="transfer-route-details" hidden={!quote.validation.valid}>
        <h2 className="border-b border-border pb-2.5 text-sm font-medium">Your route</h2>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="selected-provider text-foreground text-sm font-medium">{bridgeProviders[route.provider].label}</strong>
            <span className="rounded-md border border-border bg-surface-muted px-2 py-0.5 text-xs">{providerSelection === "automatic" ? "Automatic" : "Manual"}</span>
          </div>
          <button className="route-trigger min-h-11 min-w-11 rounded text-sm text-accent-foreground hover:underline" type="button" ref={triggerRef}
            aria-expanded={routeMenuOpen && quote.validation.valid} aria-controls="bridge-route-options"
            onClick={() => onChange({ type: "route-menu", open: !routeMenuOpen })}>
            {routeMenuOpen ? "Close" : "Change"}
          </button>
        </div>
        <div className="route-received wrap-anywhere text-3xl font-medium" aria-label="Route received amount">{quote.received} <span>{route.destination.symbol}</span></div>
        <div id="bridge-route-options" className="my-3 grid gap-2" role="group" aria-label="Compatible providers"
          hidden={!routeMenuOpen} onKeyDown={event => {
            if (event.key === "Escape") { event.preventDefault(); closeMenu(); }
          }}>
          <ProviderOptions route={route} amount={amount} received={quote.received} fee={quote.fee} onSelect={next => {
            onChange({ type: "route", route: next, manual: true });
            closeMenu();
          }} />
        </div>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3">
          <DetailsList layout="inline" className="quote-summary" aria-label="Route quote" items={[
            (quote.fees.charging === "additional" || quote.fees.charging === "deducted") && { label: quote.fees.label, value: quote.fee },
            quote.fees.showEta && { label: "ETA", value: quote.estimate.eta },
            { label: "Network fee", value: quote.networkFee },
          ]} />
          <div className="route-context text-muted-foreground items-center gap-1.5 ml-auto text-xs flex">
            <span>{providerSelection === "manual" ? "Selected by you" : "Selected automatically"}</span>
            <InfoTip label={quote.estimate.warning} />
          </div>
        </div>
      </div>
      <div className="primary-action-dock mt-4 mobile:sticky mobile:top-[calc(100dvh-67px-env(safe-area-inset-bottom))] mobile:z-3 mobile:pb-[env(safe-area-inset-bottom)]">
        <Button variant="bridge" className="primary-button" type="button" onClick={onPrimaryAction}
          disabled={cta.disabled || Boolean(quote.validation.error) || (cta.action === "review" && quote.capBlocked)}>
          {cta.action === "review" ? "Review transfer" : cta.label}
          {isSubmitting ? <RefreshCcw size={18} className="animate-spin" aria-hidden="true" /> : null}
        </Button>
      </div>
      {children}
    </Card>
  );
}
