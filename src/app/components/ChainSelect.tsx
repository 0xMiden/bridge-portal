"use client";

import { bridgeProviders } from "../../bridge/providers/registry";
import { sameAsset } from "../../bridge/core/assets";
import { routesForEnvironment, routeEnvironment, type BridgeRoute } from "../../bridge/core/routes";
import { networkLabels } from "../lib/bridge-presentation";
import { NetworkLogo } from "./AssetLogo";
import { ListboxSelect } from "./ListboxSelect";

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
  const routes = routesForEnvironment(routeEnvironment(route)).filter((option) => (!option.disabled || option.transport === "cctp-helper") && option.mode === route.mode && !bridgeProviders[option.provider].disabled);
  const networks = [...new Set(routes.map((option) => option[side].network))];
  const label = networkLabels[asset.network];
  const menuLabel = side === "source" ? "Origin chain" : "Destination chain";

  if (asset.kind === "miden" || networks.length < 2) {
    return <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground mobile:gap-1">
      <NetworkLogo network={asset.network} />
      <strong className="text-sm/normal font-medium mobile:text-xs">{label}</strong>
    </span>;
  }

  return (
    <ListboxSelect
      kind="chain"
      label={menuLabel}
      menuLabel={menuLabel}
      heading="Select network"
      value={asset.network}
      options={networks.map((network) => ({
        value: network,
        label: networkLabels[network],
        content: <><NetworkLogo network={network} /><span>{networkLabels[network]}</span></>,
      }))}
      onChange={(network) => {
        const candidates = routes.filter((option) => option[side].network === network);
        const midenSide = side === "source" ? "destination" : "source";
        // Keep the Miden asset when the new chain supports it; otherwise use
        // the matching source symbol, then the chain's first enabled route.
        const next = candidates.find((option) => sameAsset(option[midenSide], route[midenSide]))
          ?? candidates.find((option) => option[side].symbol === asset.symbol)
          ?? candidates[0];
        if (next) onSelectRoute(next);
      }}
    >
      <NetworkLogo network={asset.network} variant="selector" />
      <span className="chain-select-label truncate mobile:whitespace-normal mobile:text-left mobile:leading-tight" title={label}>{label}</span>
    </ListboxSelect>
  );
}
