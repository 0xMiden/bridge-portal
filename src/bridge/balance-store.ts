import { QueryClient, queryOptions, skipToken } from "@tanstack/react-query";
import { formatUnits } from "viem";
import type { MidenFiWalletContextState } from "@miden-sdk/miden-wallet-adapter-react";
import type { EvmAsset, MidenAsset } from "./core/assets";
import { tokenRegistry } from "../config/token-registry";
import { midenBalanceScope, type MidenBalances } from "./miden-balances";

export type SepoliaAsset = EvmAsset & { network: "sepolia" };
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
const midenAssets = [...tokenRegistry.testnet, ...tokenRegistry.mainnet].map(({ miden }) => miden);

function evmKey(account: string, asset: EvmAsset) {
  return ["balances", asset.network, account.toLowerCase(), asset.kind,
    asset.kind === "erc20" ? asset.address.toLowerCase() : "native"] as const;
}

/** App-session balances, loaded after connection grants asset access. */
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
    const assetsBecameAvailable = !this.midenSession?.requestAssets && Boolean(session?.requestAssets);
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
    if (session && (changed || assetsBecameAvailable)) {
      // One automatic read per session. The query retains errors for the UI;
      // retry is explicit so denied access never becomes a prompt loop.
      void this.requestMiden(session.account, session.network).catch(() => {});
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

  /** Connection, refresh, and wallet-menu sync share the same in-flight read. */
  requestMiden(account: string, network: MidenAsset["network"], refresh = false): Promise<MidenBalances> {
    const session = this.midenSession;
    if (!session ||
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
        if (!requestAssets) throw new Error("Your Miden wallet does not support balance access. Reconnect with Bread wallet.");
        let expired = false;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const timeoutError = new Error("Balance check timed out. Sync your Bread wallet and try again.");
        const assertCurrent = () => {
          if (expired) throw timeoutError;
          if (version !== this.midenSessionVersion) throw new Error("Miden account changed");
        };
        const read = async () => {
          const { fetchMidenBalances } = await import("./miden-balances");
          assertCurrent();
          const balances = await fetchMidenBalances(account, midenAssets.filter((asset) => asset.network === network), () => {
            // SDK loading can outlive the timeout or wallet session. Never open
            // an obsolete permission prompt or publish its eventual response.
            assertCurrent();
            return requestAssets();
          }, network);
          assertCurrent();
          return balances;
        };
        try {
          return await Promise.race([
            read(),
            new Promise<never>((_, reject) => {
              timeout = setTimeout(() => { expired = true; reject(timeoutError); }, 45_000);
            }),
          ]);
        } finally {
          if (timeout) clearTimeout(timeout);
        }
      },
    }).then((balances) => {
      if (version !== this.midenSessionVersion) throw new Error("Miden account changed");
      return balances;
    });
  }

  evmQuery(account: string, asset: EvmAsset) {
    return queryOptions({
      queryKey: evmKey(account, asset),
      enabled: Boolean(account),
      staleTime: 30_000,
      retry: false,
      queryFn: async ({ signal }): Promise<TokenBalance> => {
        const params = new URLSearchParams({ address: account });
        if (asset.kind === "erc20") {
          params.set("token", asset.address);
          params.set("decimals", String(asset.decimals));
        }
        const response = await fetch(`/api/evm/${asset.network}/balance?${params}`, { signal });
        if (!response.ok) throw new Error("Unable to fetch balance");
        const payload: { balanceRaw?: string } = await response.json();
        const raw = payload.balanceRaw;
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
    return this.client.invalidateQueries({ queryKey: evmKey(account, asset) });
  }
}
