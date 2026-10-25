import type { MidenFiWalletContextState } from "@miden-sdk/miden-wallet-adapter-react";
import type { MidenAsset } from "./core/assets";
import { getMidenFaucetMetadata } from "./miden-rpc";

type RequestAssets = NonNullable<MidenFiWalletContextState["requestAssets"]>;

export interface ResolvedMidenAsset {
  faucetId: string;
  amountRaw: bigint;
  /** On-chain precision when available, otherwise the asset's configured value. */
  decimals: number;
  symbol: string;
  /** Trusted registry identity; never inferred from a faucet's reported symbol. */
  pricingSymbol?: string;
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

/** One private-assets request retains the complete account, including unknown faucets. */
export async function fetchMidenBalances(
  account: string,
  tokens: readonly MidenAsset[],
  requestAssets: RequestAssets,
  network: MidenAsset["network"] = tokens[0]?.network ?? "miden-testnet",
): Promise<MidenBalances> {
  const { formatUnits } = await import("viem");
  const { normalizeMidenIdToHex } = await import("./miden-address-sdk");
  const canon = (id: string) => {
    try {
      return normalizeId(normalizeMidenIdToHex(id));
    } catch {
      return normalizeId(id);
    }
  };
  const resolveMetadata = async (asset: MidenAsset) => {
    try {
      const metadata = await getMidenFaucetMetadata(asset.faucetId, asset.network);
      if (metadata) return metadata;
    } catch {
      // Unavailable or private faucet metadata uses the configured precision.
    }
    return { decimals: asset.decimals, symbol: asset.symbol };
  };

  const assets = await requestAssets();
  const byFaucet = new Map<string, bigint>();
  for (const asset of assets) {
    const faucet = canon(asset.faucetId);
    byFaucet.set(faucet, (byFaucet.get(faucet) ?? 0n) + BigInt(asset.amount));
  }

  const balances: Record<string, ResolvedMidenAsset & { balance: string }> = {};
  const registered = new Set<string>();
  for (const token of tokens) {
    if (token.network !== network) continue;
    const faucet = canon(token.faucetId);
    if (registered.has(faucet)) continue;
    registered.add(faucet);
    const key = midenBalanceKey(account, token);
    const amountRaw = byFaucet.get(faucet) ?? 0n;
    const metadata = amountRaw > 0n ? await resolveMetadata(token) : token;
    balances[key] = {
      faucetId: token.faucetId,
      amountRaw,
      decimals: metadata.decimals,
      symbol: metadata.symbol,
      pricingSymbol: token.symbol,
      balance: formatUnits(amountRaw, metadata.decimals),
    };
  }
  for (const [faucetId, amountRaw] of byFaucet) {
    if (registered.has(faucetId)) continue;
    // Preserve unknown holdings without inventing a trusted market or precision.
    // The deposit cap skips these unpriced assets.
    balances[midenBalanceKey(account, { network, faucetId })] = {
      faucetId, amountRaw, decimals: 0, symbol: "Unknown asset", balance: amountRaw.toString(),
    };
  }
  return balances;
}
