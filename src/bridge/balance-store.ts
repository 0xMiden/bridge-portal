import { QueryClient, queryOptions, skipToken } from "@tanstack/react-query";
import { formatUnits } from "viem";
import type { MidenFiWalletContextState } from "@miden-sdk/miden-wallet-adapter-react";
import type { BridgeAsset, MidenAsset } from "./core/assets";
import { bridgeRoutes } from "./core/routes";
import { midenBalanceScope, type MidenBalances } from "./miden-balances";

export type SepoliaAsset = Extract<BridgeAsset, { network: "sepolia" }>;
export type TokenBalance = {
  amountRaw: bigint;
  balance: string;
  decimals: number;
  symbol: string;
};

type MidenSession = {
  account: string;
  network: MidenAsset["network"];
  requestAssets: MidenFiWalletContextState["requestAssets"];
};

const midenQueryPrefix = ["balances", "miden"] as const;
const midenAssets = bridgeRoutes
  .flatMap((route) => [route.source, route.destination])
  .filter((asset): asset is MidenAsset => asset.kind === "miden");

function sepoliaKey(account: string, asset: SepoliaAsset) {
  return ["balances", asset.network, account.toLowerCase(), asset.kind,
    asset.kind === "erc20" ? asset.address.toLowerCase() : "native"] as const;
}

/** App-session balance storage. Private reads are only started by explicit commands. */
export class BalanceStore {
  private midenSession: MidenSession | null = null;
  private midenSessionVersion = 0;

  constructor(private readonly client: QueryClient) {}

  /** Called by the app-root wallet adapter, including when the bridge is unmounted. */
  setMidenSession(session: MidenSession | null) {
    const scope = (value: MidenSession | null) => value
      ? midenBalanceScope(value.account, value.network)
      : null;
    const changed = scope(session) !== scope(this.midenSession);
    this.midenSession = session;
    if (changed) {
      this.midenSessionVersion += 1;
      // Reset notifies mounted readers; cancellation prevents late wallet responses
      // from restoring private data after disconnect or an account change.
      void this.client.resetQueries({ queryKey: midenQueryPrefix });
      // Keep empty queries with subscribers so a reconnect still updates them.
      this.client.removeQueries({
        queryKey: midenQueryPrefix,
        predicate: (query) => query.getObserversCount() === 0,
      });
    }
  }

  midenQuery(account: string, network: MidenAsset["network"]) {
    return queryOptions<MidenBalances>({
      queryKey: [...midenQueryPrefix, midenBalanceScope(account, network)],
      queryFn: skipToken,
      enabled: false,
      retry: false,
      staleTime: Infinity,
      gcTime: Infinity,
      networkMode: "always",
    });
  }

  /** Show/refresh and wallet-menu sync share one permission request per session. */
  requestMiden(account: string, network: MidenAsset["network"], refresh = false): Promise<MidenBalances> {
    const session = this.midenSession;
    if (!session?.requestAssets ||
        midenBalanceScope(account, network) !== midenBalanceScope(session.account, session.network)) {
      return Promise.reject(new Error("Connect your Miden wallet before reading its balance."));
    }
    const options = this.midenQuery(account, network);
    const retry = this.client.getQueryState(options.queryKey)?.status === "error";
    const requestAssets = session.requestAssets;
    const version = this.midenSessionVersion;
    return this.client.fetchQuery({
      ...options,
      staleTime: refresh || retry ? 0 : Infinity,
      queryFn: async () => {
        const { fetchMidenBalances } = await import("./miden-balances");
        return fetchMidenBalances(account, midenAssets.filter((asset) => asset.network === network), () => {
          // Loading the SDK is asynchronous. Do not open a popup for a session
          // that ended while it was loading, even if the same account reconnects.
          if (version !== this.midenSessionVersion) throw new Error("Miden account changed");
          return requestAssets();
        });
      },
    });
  }

  sepoliaQuery(account: string, asset: SepoliaAsset) {
    return queryOptions({
      queryKey: sepoliaKey(account, asset),
      enabled: Boolean(account),
      staleTime: 30_000,
      retry: false,
      queryFn: async ({ signal }): Promise<TokenBalance> => {
        const params = new URLSearchParams({ address: account });
        if (asset.kind === "erc20") {
          params.set("token", asset.address);
          params.set("decimals", String(asset.decimals));
        }
        const response = await fetch(`/api/sepolia/balance?${params}`, { signal });
        if (!response.ok) throw new Error("Unable to fetch balance");
        const payload: { balanceWei?: string; balanceRaw?: string } = await response.json();
        const raw = asset.kind === "erc20" ? payload.balanceRaw : payload.balanceWei;
        if (raw === undefined) throw new Error("Balance response is missing the token amount");
        const amountRaw = BigInt(raw);
        return {
          amountRaw,
          balance: formatUnits(amountRaw, asset.decimals),
          decimals: asset.decimals,
          symbol: asset.symbol,
        };
      },
    });
  }

  /** A mint invalidates the minted token even if another route is currently shown. */
  invalidateSepolia(account: string, asset: SepoliaAsset) {
    return this.client.invalidateQueries({ queryKey: sepoliaKey(account, asset) });
  }
}
