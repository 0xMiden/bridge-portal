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
  const selectedToken = <><TokenLogo asset={active} compact /><span className="token-select-symbol tracking-[-0.02em]">{active.symbol}</span></>;

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
          content: <><TokenLogo asset={token} /><span className="token-option-text flex min-w-0 flex-col gap-px"><strong className="text-[15px]/[1.4] font-semibold">{token.symbol}</strong><small className="text-xs/[1.4] text-muted-foreground">{name}</small></span></>,
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
