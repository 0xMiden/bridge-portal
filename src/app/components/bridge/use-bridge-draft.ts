import { useEffect, useReducer } from "react";
import { useSearchParams, type ReadonlyURLSearchParams } from "next/navigation";
import { isFlowMode, type FlowMode } from "../../../bridge/core/models";
import { defaultBridgeRoute, reverseBridgeRoute, routesForEnvironment, type BridgeRoute } from "../../../bridge/core/routes";
import { routeSwitchChangesAsset } from "../../../bridge/core/rules";
import { bridgeProviders, isBridgeProvider } from "../../../bridge/providers/registry";
import type { BridgeEnvironment } from "../../../config/environment";
import { loadStoredMode, loadStoredRoute, loadStoredRouteId, saveStoredMode, saveStoredRoute } from "../../lib/bridge-persistence";

export interface BridgeDraft {
  route: BridgeRoute;
  amount: string;
}

export type DraftAction =
  | { type: "amount"; amount: string }
  | { type: "mode"; mode: FlowMode }
  | { type: "route"; route: BridgeRoute };

function initialRoute(params: ReadonlyURLSearchParams, environment: BridgeEnvironment) {
  const requestedProvider = params.get("provider");
  const provider = isBridgeProvider(requestedProvider) && !bridgeProviders[requestedProvider].disabled
    ? requestedProvider : loadStoredRoute(environment) ?? "xreserve";
  const requestedMode = params.get("mode");
  const mode = isFlowMode(requestedMode) ? requestedMode : loadStoredMode(environment) ?? "receive";
  const saved = loadStoredRouteId(environment);
  const route =
    (saved?.provider === provider && saved.mode === mode && !saved.disabled ? saved : undefined) ??
    defaultBridgeRoute(provider, mode, environment) ??
    defaultBridgeRoute(provider, "receive", environment) ??
    routesForEnvironment(environment).find(option => !option.disabled && !bridgeProviders[option.provider].disabled);
  if (!route) throw new Error(`No bridge routes available on ${environment}.`);
  return route;
}

function reduceDraft(state: BridgeDraft, action: DraftAction): BridgeDraft {
  switch (action.type) {
    case "amount":
      return { ...state, amount: action.amount };
    case "mode": {
      const route = action.mode === state.route.mode ? state.route : reverseBridgeRoute(state.route);
      return route ? { route, amount: "" } : state;
    }
    case "route": {
      const route = action.route;
      // An unavailable manual source can be inspected, while admission stays gated.
      if (route.disabled && route.transport !== "cctp-helper") return state;
      if (bridgeProviders[route.provider].disabled) return state;
      if (route.id === state.route.id) return state;
      return {
        route,
        amount: routeSwitchChangesAsset(state.route, route) ? "" : state.amount,
      };
    }
  }
}

/** Route edits reset dependent fields together; only the route is persisted. */
export function useBridgeDraft(environment: BridgeEnvironment) {
  const params = useSearchParams();
  const [draft, dispatch] = useReducer(reduceDraft, null, (): BridgeDraft => ({
    route: initialRoute(params, environment),
    amount: "",
  }));
  useEffect(() => {
    saveStoredRoute(draft.route.provider, draft.route.id, environment);
    saveStoredMode(draft.route.mode, environment);
  }, [draft.route, environment]);
  return { draft, dispatch };
}
