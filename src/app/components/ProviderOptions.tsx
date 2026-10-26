import { Check, Clock3, LoaderCircle } from "lucide-react";
import { useId } from "react";
import type { BridgeRoute } from "../../bridge/core/routes";
import type { TransferQuote } from "../../bridge/core/quote";
import { bridgeProviders, directionFor } from "../../bridge/providers/registry";
import { selectedProviderQuote, type ProviderQuote } from "../lib/provider-quotes";
import { ProviderLogo } from "./ProviderLogo";
import { InfoTip } from "./InfoTip";
import { Card } from "./ui/Card";

export function ProviderOptions({ route, offers, ready, loading, onRetry, onSelect }: {
  route: BridgeRoute;
  offers: ProviderQuote[];
  ready: boolean;
  loading: boolean;
  onRetry: () => void;
  onSelect: (route: BridgeRoute) => void;
}) {
  const groupId = useId();
  const selectedOffer = ready ? selectedProviderQuote(route, offers) : undefined;
  const selectedRoute = selectedOffer?.route ?? route;
  const selectedPolicy = directionFor(selectedRoute).fees(selectedRoute);
  const selectable = ready && offers.length > 1;

  return (
    <Card className="provider-card" aria-labelledby={`${groupId}-label`} aria-busy={loading}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id={`${groupId}-label`} className="flex items-center gap-2 text-base font-semibold">
          Routes
          {ready && offers.length > 0 ? <span className="text-xs font-normal text-muted-foreground">{offers.length}</span> : null}
        </h2>
        <span className="flex items-center gap-2">
          {loading ? <LoaderCircle size={16} className="animate-spin text-muted-foreground" role="status" aria-label="Fetching quotes" /> : null}
          {selectedOffer || !ready ? <InfoTip label={selectedPolicy.warning} /> : null}
        </span>
      </div>
      {ready && !offers.length ? (
        <div className="flex min-h-16 items-center justify-between gap-3 text-sm">
          <span role="status" className="text-muted-foreground">{loading ? "Fetching quotes…" : "No quotes available"}</span>
          {!loading ? <button type="button" className="min-h-11 font-semibold text-accent-foreground underline underline-offset-3" onClick={onRetry}>Retry</button> : null}
        </div>
      ) : (
        <fieldset className="grid gap-2" aria-label="Compatible providers">
          {ready ? offers.map(offer => (
            <ProviderRouteOption key={offer.route.id} route={offer.route} quote={offer.quote}
              selected={offer.route.id === selectedRoute.id} selectable={selectable} groupId={groupId} onSelect={onSelect} />
          )) : <ProviderRouteOption route={route} selected={false} selectable={false} groupId={groupId} onSelect={onSelect} />}
        </fieldset>
      )}
    </Card>
  );
}

function ProviderRouteOption({ route, quote, selected, selectable, groupId, onSelect }: {
  route: BridgeRoute;
  quote?: TransferQuote;
  selected: boolean;
  selectable: boolean;
  groupId: string;
  onSelect: (route: BridgeRoute) => void;
}) {
  const policy = directionFor(route).fees(route);
  const provider = bridgeProviders[route.provider];
  const detailsId = `${groupId}-${route.id}`;
  const Option = selectable ? "label" : "div";
  const secondary = selected ? "text-accent-foreground" : "text-muted-foreground";

  return (
    <Option className={`provider-option relative min-w-0 ${selectable ? "cursor-pointer" : ""}`}>
      {selectable ? <input type="radio" className="peer sr-only" name={groupId} value={route.id}
        checked={selected} aria-label={provider.label} aria-describedby={detailsId}
        onChange={() => onSelect(route)} /> : null}
      <span className={`flex items-center gap-3 rounded-xl border p-3 transition-colors
        peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent-foreground
        ${selected ? "border-accent bg-accent-soft" : "border-border bg-surface"}
        ${selectable && !selected ? "hover:border-border-strong hover:bg-field" : ""}`}>
        <ProviderLogo provider={route.provider} />
        <span id={detailsId} className="grid min-w-0 flex-1 gap-1">
          <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <strong className={`${selected || !quote ? "selected-provider " : ""}text-sm leading-5 font-semibold`}>{provider.label}</strong>
            <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs leading-5 tabular-nums ${secondary}`}>
              <Clock3 size={13} aria-hidden="true" /><span className="sr-only">Estimated time: </span>{policy.showEta ? policy.eta : "Varies"}
            </span>
          </span>
          <span className="flex min-w-0 items-center justify-between gap-3">
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
              {quote ? <span className="sr-only">You receive</span> : null}
              <span className={`min-w-0 text-xl leading-6 font-semibold tabular-nums wrap-anywhere ${quote ? "" : "text-muted-foreground"}`}>{quote?.received ?? "—"}</span>
              <span className={`text-sm leading-5 ${secondary}`}>{route.destination.symbol}</span>
            </span>
            <span className="flex size-5 shrink-0 items-center justify-center" aria-hidden="true">
              {selected || selectable ? <span className={`grid size-4 place-items-center rounded-full border
                ${selected ? "border-accent-foreground bg-accent-foreground text-surface" : "border-muted-foreground"}`}>
                {selected ? <Check size={11} strokeWidth={3} /> : null}
              </span> : null}
            </span>
          </span>
        </span>
      </span>
    </Option>
  );
}
