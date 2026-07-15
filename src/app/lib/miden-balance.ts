import type { MidenFiWalletContextState } from "@miden-sdk/miden-wallet-adapter-react";

// Reads the connected MidenFi wallet's per-token balances. Miden balances are
// private, so this calls `requestAssets()` — which opens a wallet permission
// popup — and can't be done from a public RPC. Dynamic-imported at call time so
// the eager-WASM SDK never reaches SSR.

export interface MidenBalanceTarget {
  /** Caller key to read the result back by (e.g. the provider name). */
  key: string;
  /** Faucet account id (hex `0x…` or bech32) for the token to total. */
  faucetId: string;
  /** Faucet decimals for formatting. */
  decimals: number;
}

/**
 * Fetch the wallet's asset list once and total each target token, returning a
 * `{ [key]: formattedAmount }` map ("0" when the wallet holds none). One popup
 * covers every target, so callers should pass all tokens they need at once.
 */
export async function fetchMidenBalances(
  requestAssets: NonNullable<MidenFiWalletContextState["requestAssets"]>,
  targets: MidenBalanceTarget[],
): Promise<Record<string, string>> {
  const { AccountId } = await import("@miden-sdk/miden-sdk");
  const { formatUnits } = await import("viem");

  // Canonicalize any faucet id form (hex / bech32) to a comparable string.
  const canon = (id: string): string => {
    const s = id.trim();
    try {
      if (s.startsWith("0x")) return AccountId.fromHex(s).toString().toLowerCase();
      return AccountId.fromBech32(s).toString().toLowerCase();
    } catch {
      return s.toLowerCase();
    }
  };

  const assets = await requestAssets();
  const byFaucet = new Map<string, bigint>();
  for (const asset of assets) {
    const prev = byFaucet.get(canon(asset.faucetId)) ?? 0n;
    byFaucet.set(canon(asset.faucetId), prev + BigInt(asset.amount));
  }

  const out: Record<string, string> = {};
  for (const target of targets) {
    const raw = byFaucet.get(canon(target.faucetId)) ?? 0n;
    out[target.key] = formatUnits(raw, target.decimals);
  }
  return out;
}
