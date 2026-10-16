import { ArrowRight, Check } from "lucide-react";
import { sameAsset } from "../../bridge/core/assets";
import { bridgeRoutes, type BridgeRoute } from "../../bridge/core/routes";
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
  const compatible = bridgeRoutes.filter((candidate) =>
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
        className={`route-option provider-option ${selected ? "selected" : ""}`}
        type="button"
        aria-pressed={selected}
        onClick={() => onSelect(candidate)}
      >
        <span className="route-option-head">
          <strong>{provider.label}</strong>
          <small className="route-tag testnet">{provider.badge}</small>
          {selected ? <Check className="route-check" size={16} aria-hidden="true" /> : null}
        </span>
        <span className="provider-route-path">
          <span>{candidate.source.symbol} · {networkLabels[candidate.source.network]}</span>
          <ArrowRight size={13} aria-hidden="true" />
          <span>{candidate.destination.symbol} · {networkLabels[candidate.destination.network]}</span>
        </span>
        <span className="provider-output">
          {!amount ? "Enter an amount" : output === "—" || !output ? "Quote unavailable" : `${output} ${candidate.destination.symbol}`}
          <small>{selected ? "Selected · You receive" : "Estimated received"}</small>
        </span>
        <span className="provider-costs">
          <span>{selected ? fee : policy?.bridgeFee}</span>
          <span>{policy?.showEta ? policy.eta : "Time varies"}</span>
        </span>
      </button>
    );
  });
}
