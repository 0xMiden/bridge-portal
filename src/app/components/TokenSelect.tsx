"use client";

import { bridgeProviders } from "../../bridge/providers/registry";
import { assetKey } from "../../bridge/core/assets";
import { routesForEnvironment, routeEnvironment, type BridgeRoute } from "../../bridge/core/routes";
import { networkLabels, tokenNames } from "../lib/bridge-presentation";
import { tokenChoices } from "../lib/token-choices";
import { TokenLogo } from "./AssetLogo";
import { ListboxSelect } from "./ListboxSelect";

/** Select a bridgeable token while keeping the chosen external chain. */
export function TokenSelect({
  route,
  side,
  onSelectRoute,
}: {
  route: BridgeRoute;
  side: "source" | "destination";
  onSelectRoute: (route: BridgeRoute) => void;
}) {
  const active = route[side];
  const routes = routesForEnvironment(routeEnvironment(route)).filter((option) => !bridgeProviders[option.provider].disabled);
  const options = tokenChoices(route, side, routes);
  const selectedToken = <><TokenLogo asset={active} /><span className="token-select-symbol">{active.symbol}</span></>;

  return (
    <ListboxSelect
      kind="token"
      searchable
      label={`${active.symbol} — change token`}
      menuLabel="Token"
      heading="Select token"
      context={networkLabels[active.network]}
      value={assetKey(active)}
      options={options.map(({ asset: token }) => {
        const name = token.name ?? tokenNames[token.symbol] ?? token.symbol;
        return {
          value: assetKey(token),
          label: `${token.symbol} ${name}`,
          content: <><TokenLogo asset={token} /><span className="token-option-text"><strong>{token.symbol}</strong><small>{name}</small></span></>,
        };
      })}
      onChange={(id) => {
        const next = options.find(({ asset }) => assetKey(asset) === id);
        if (next) onSelectRoute(next.route);
      }}
    >
      {selectedToken}
    </ListboxSelect>
  );
}
