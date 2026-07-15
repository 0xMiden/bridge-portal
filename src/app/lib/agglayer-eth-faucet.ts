import type { MidenFiWalletContextState } from "@miden-sdk/miden-wallet-adapter-react";

// The Agglayer wrapped-ETH on Miden has a deployment-specific faucet id: Gateway
// mints a fresh faucet account on every rollup redeploy, so a hardcoded id (the
// portal's old `0x387149ae…`, which isn't even a faucet on the current chain)
// is guaranteed to rot. Resolve it at runtime from the connected wallet's own
// assets instead — it survives every redeploy.
//
// Classification: Epoch's USDC faucet is a stable known token; the chain's
// native fee asset is gas. On the Agglayer route, whatever else the wallet holds
// is the bridged ETH.

const EPOCH_USDC_FAUCET = "0xfc90f0f4da30e51168453b60eafed7";

type RequestAssets = NonNullable<MidenFiWalletContextState["requestAssets"]>;

export interface ResolvedEthAsset {
  /** Canonical 0x-hex faucet id of the bridged ETH the wallet holds. */
  faucetId: string;
  /** Raw base-unit balance held. */
  amountRaw: bigint;
  /** The faucet's real decimals (read on-chain — not the old 8-dp guess). */
  decimals: number;
  symbol: string;
}

export interface MidenRouteBalances {
  /** Human-formatted balances keyed by route. */
  epoch: string;
  agglayer: string;
  /** The resolved Agglayer ETH faucet + decimals, for the send path. */
  agglayerEth: ResolvedEthAsset | null;
}

/**
 * One `requestAssets()` popup, both route balances. USDC totals against Epoch's
 * known faucet; the Agglayer ETH is resolved as the non-USDC, non-gas fungible
 * the wallet holds, with its decimals/symbol read from the faucet on-chain.
 */
export async function fetchMidenRouteBalances(
  requestAssets: RequestAssets,
): Promise<MidenRouteBalances> {
  const sdk = await import("@miden-sdk/miden-sdk");
  const { AccountId, RpcClient, Endpoint, BasicFungibleFaucetComponent } =
    sdk as unknown as {
      AccountId: {
        fromHex: (s: string) => { toString: () => string };
        fromBech32: (s: string) => { toString: () => string };
      };
      RpcClient: new (e: unknown) => {
        getBlockHeaderByNumber: (n?: number) => Promise<{
          feeFaucetId: () => { toString: () => string };
        }>;
        getAccountDetails: (id: unknown) => Promise<{ account: () => unknown }>;
      };
      Endpoint: { testnet: () => unknown };
      BasicFungibleFaucetComponent: {
        fromAccount: (a: unknown) => {
          decimals: () => number;
          symbol: () => { toString: () => string };
        };
      };
    };
  const { formatUnits } = await import("viem");

  const canon = (id: string): string => {
    const s = id.trim();
    try {
      return (s.startsWith("0x") ? AccountId.fromHex(s) : AccountId.fromBech32(s))
        .toString()
        .toLowerCase();
    } catch {
      return s.toLowerCase();
    }
  };

  const rpc = new RpcClient(Endpoint.testnet());

  // Exclude the native fee/gas asset so it isn't mistaken for bridged ETH.
  let feeFaucet = "";
  try {
    const header = await rpc.getBlockHeaderByNumber(undefined);
    feeFaucet = header.feeFaucetId().toString().toLowerCase();
  } catch {
    // best effort — if unavailable, we only exclude USDC below
  }

  const usdc = canon(EPOCH_USDC_FAUCET);

  const assets = await requestAssets();
  const byFaucet = new Map<string, bigint>();
  for (const a of assets) {
    const f = canon(a.faucetId);
    byFaucet.set(f, (byFaucet.get(f) ?? 0n) + BigInt(a.amount));
  }

  const usdcRaw = byFaucet.get(usdc) ?? 0n;

  // Bridged ETH = the positive-balance fungible that's neither USDC nor gas.
  const ethEntry = [...byFaucet.entries()].find(
    ([f, amt]) => f !== usdc && f !== feeFaucet && amt > 0n,
  );

  let agglayerEth: ResolvedEthAsset | null = null;
  if (ethEntry) {
    const [faucetId, amountRaw] = ethEntry;
    let decimals = 8;
    let symbol = "ETH";
    try {
      const fetched = await rpc.getAccountDetails(AccountId.fromHex(faucetId) as unknown);
      const faucet = BasicFungibleFaucetComponent.fromAccount(fetched.account());
      decimals = faucet.decimals();
      symbol = faucet.symbol().toString();
    } catch {
      // fall back to ETH/8 if the faucet metadata can't be read
    }
    agglayerEth = { faucetId, amountRaw, decimals, symbol };
  }

  return {
    epoch: formatUnits(usdcRaw, 6),
    agglayer: agglayerEth
      ? formatUnits(agglayerEth.amountRaw, agglayerEth.decimals)
      : "0",
    agglayerEth,
  };
}
