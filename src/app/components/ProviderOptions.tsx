import { ArrowRight, Check } from "lucide-react";
import { sameAsset } from "../../bridge/core/assets";
import { routesForEnvironment, routeEnvironment, type BridgeRoute } from "../../bridge/core/routes";
import { bridgeProviders, directionFor } from "../../bridge/providers/registry";
import { networkLabels, quoteFor } from "../lib/bridge-presentation";

/** Only providers supporting both exact assets belong in the disclosure. */
export function ProviderOptions({ route, amount, received, fee, onSelect }: {
  route: BridgeRoute;
  amount: string;
  received: string;
  fee: string;
  onSelect: (route: BridgeRoute) => void;
}) {
  const compatible = routesForEnvironment(routeEnvironment(route)).filter((candidate) =>
    !candidate.disabled && !bridgeProviders[candidate.provider].disabled &&
    candidate.mode === route.mode &&
    sameAsset(candidate.source, route.source) &&
    sameAsset(candidate.destination, route.destination),
  );
  return compatible.map((candidate) => {
    const provider = bridgeProviders[candidate.provider];
    const selected = candidate.id === route.id;
    const policy = directionFor(candidate).fees(candidate);
    const estimate = quoteFor(candidate, amount);
    const output = selected ? received : estimate.expectedReceived;

    return (
      <button
        key={candidate.id}
        className="provider-option grid w-full gap-2 rounded-sm border border-border p-3 text-left transition
          hover:bg-surface-muted aria-pressed:border-accent-border aria-pressed:bg-accent-soft"
        type="button"
        aria-pressed={selected}
        onClick={() => onSelect(candidate)}
      >
        <span className="flex items-center gap-2">
          <strong className="truncate text-sm font-semibold">{provider.label}</strong>
          <small className="route-tag testnet rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent-foreground">{routeEnvironment(candidate) === "mainnet" ? "Mainnet" : provider.badge}</small>
          {selected ? <Check className="route-check text-accent flex-none ml-auto" size={16} aria-hidden="true" /> : null}
        </span>
        <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span>{candidate.source.symbol} · {networkLabels[candidate.source.network]}</span>
          <ArrowRight className="flex-none" size={13} aria-hidden="true" />
          <span>{candidate.destination.symbol} · {networkLabels[candidate.destination.network]}</span>
        </span>
        <span className="grid text-2xl font-medium tabular-nums wrap-anywhere">
          {!amount ? "Enter an amount" : output === "—" || !output ? "Quote unavailable" : `${output} ${candidate.destination.symbol}`}
          <small className="text-xs text-muted-foreground">{selected ? "Selected · You receive" : "Estimated received"}</small>
        </span>
        <span className="provider-costs text-muted-foreground flex-wrap justify-between gap-2 text-xs font-medium flex">
          <span>{selected ? fee : policy?.bridgeFee}</span>
          <span>{policy?.showEta ? policy.eta : "Time varies"}</span>
        </span>
      </button>
    );
  });
}
