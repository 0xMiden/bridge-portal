"use client";

import { ChevronDown } from "lucide-react";
import { sameAsset } from "../../bridge/core/assets";
import { bridgeRoutes, type BridgeRoute } from "../../bridge/core/routes";
import { networkLabels, providers } from "../lib/bridge-presentation";

/** Miden stays fixed; the external chain only offers enabled bridge routes. */
export function ChainSelect({
  route,
  side,
  onSelectRoute,
}: {
  route: BridgeRoute;
  side: "source" | "destination";
  onSelectRoute: (route: BridgeRoute) => void;
}) {
  const asset = route[side];
  const routes = bridgeRoutes.filter((option) => option.mode === route.mode && !providers[option.provider].disabled);
  const networks = [...new Set(routes.map((option) => option[side].network))];
  const label = networkLabels[asset.network];

  if (asset.kind === "miden" || networks.length < 2) return <strong>{label}</strong>;

  return (
    <span className="chain-select">
      <select
        aria-label={side === "source" ? "Origin chain" : "Destination chain"}
        value={asset.network}
        onChange={(event) => {
          const candidates = routes.filter((option) => option[side].network === event.target.value);
          const midenSide = side === "source" ? "destination" : "source";
          // Keep the Miden asset when the new chain supports it; otherwise use
          // the matching source symbol, then the chain's first enabled route.
          const next = candidates.find((option) => sameAsset(option[midenSide], route[midenSide]))
            ?? candidates.find((option) => option[side].symbol === asset.symbol)
            ?? candidates[0];
          if (next) onSelectRoute(next);
        }}
      >
        {networks.map((network) => (
          <option key={network} value={network}>{networkLabels[network]}</option>
        ))}
      </select>
      <ChevronDown size={16} aria-hidden="true" />
    </span>
  );
}
