import type { MidenFiWalletContextState } from "@miden-sdk/miden-wallet-adapter-react";
import type { MidenAsset } from "./core/assets";
import { e2eNetwork, isE2E } from "../wallets/testing/env";

type RequestAssets = NonNullable<MidenFiWalletContextState["requestAssets"]>;

export interface ResolvedMidenAsset {
  faucetId: string;
  amountRaw: bigint;
  /** On-chain precision when available, otherwise the asset's configured value. */
  decimals: number;
  symbol: string;
}

export type MidenBalances = Readonly<Partial<Record<
  string,
  ResolvedMidenAsset & { balance: string }
>>>;

function normalizeId(id: string): string {
  return id.trim().replace(/^0x/i, "").toLowerCase();
}

/** Permission and in-flight requests belong to an account on one network. */
export function midenBalanceScope(account: string, network: MidenAsset["network"]): string {
  return JSON.stringify([normalizeId(account), network]);
}

/** Providers and route directions do not change ownership of a token balance. */
export function midenBalanceKey(account: string, asset: Pick<MidenAsset, "network" | "faucetId">): string {
  return JSON.stringify([normalizeId(account), asset.network, normalizeId(asset.faucetId)]);
}

/** One private-assets request supplies every route's token on the connected network. */
export async function fetchMidenBalances(
  account: string,
  tokens: readonly MidenAsset[],
  requestAssets: RequestAssets,
): Promise<MidenBalances> {
  const { formatUnits } = await import("viem");
  let canon = normalizeId;
  let resolveMetadata = async (asset: MidenAsset) => ({
    decimals: asset.decimals,
    symbol: asset.symbol,
  });

  // Mock E2E must not load the browser-only WASM SDK.
  if (!(isE2E() && e2eNetwork() === "mock")) {
    const { AccountId, RpcClient, Endpoint, BasicFungibleFaucetComponent } =
      await import("@miden-sdk/miden-sdk");
    const accountId = (id: string) => {
      const normalized = normalizeId(id);
      return /^[0-9a-f]+$/.test(normalized)
        ? AccountId.fromHex(`0x${normalized}`)
        : AccountId.fromBech32(id.trim());
    };
    canon = (id) => {
      try {
        return normalizeId(accountId(id).toString());
      } catch {
        return normalizeId(id);
      }
    };
    const rpc = new RpcClient(Endpoint.testnet());
    resolveMetadata = async (asset) => {
      try {
        const fetched = await rpc.getAccountDetails(accountId(asset.faucetId));
        const account = fetched.account();
        if (account) {
          const faucet = BasicFungibleFaucetComponent.fromAccount(account);
          return { decimals: faucet.decimals(), symbol: faucet.symbol().toString() };
        }
      } catch {
        // Unavailable or private faucet metadata uses the configured precision.
      }
      return { decimals: asset.decimals, symbol: asset.symbol };
    };
  }

  const assets = await requestAssets();
  const byFaucet = new Map<string, bigint>();
  for (const asset of assets) {
    const faucet = canon(asset.faucetId);
    byFaucet.set(faucet, (byFaucet.get(faucet) ?? 0n) + BigInt(asset.amount));
  }

  const balances: Record<string, ResolvedMidenAsset & { balance: string }> = {};
  for (const token of tokens) {
    const key = midenBalanceKey(account, token);
    if (balances[key]) continue;
    const amountRaw = byFaucet.get(canon(token.faucetId)) ?? 0n;
    const metadata = amountRaw > 0n ? await resolveMetadata(token) : token;
    balances[key] = {
      faucetId: token.faucetId,
      amountRaw,
      decimals: metadata.decimals,
      symbol: metadata.symbol,
      balance: formatUnits(amountRaw, metadata.decimals),
    };
  }
  return balances;
}
