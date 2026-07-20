import type { MidenFiWalletContextState } from "@miden-sdk/miden-wallet-adapter-react";
import { AGGLAYER_BALI } from "./agglayer";

// One `requestAssets()` popup, both route balances. Each route's Miden token is
// a fixed, known faucet: Epoch's USDC (`EPOCH_USDC_FAUCET`) and the Agglayer ETH
// faucet (`AGGLAYER_BALI.midenEthFaucetIdHex`, per gateway.fm PARAMETERS.md and
// the bridge-out-tool). We total the wallet's holding of each specific faucet —
// the Agglayer send then bridges that exact asset, the one the Agglayer bridge
// recognises, rather than any other Miden token the wallet may also hold.

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

  const usdc = canon(EPOCH_USDC_FAUCET);
  // The Agglayer ETH faucet is a fixed, known account on bali (gateway.fm
  // PARAMETERS.md — the same id the bridge-out-tool bridges with). Total the
  // wallet's holding of THAT faucet, exactly as we do for USDC. The previous
  // "whatever non-USDC, non-gas asset the wallet holds" heuristic mis-picked
  // any other Miden token in the wallet and bridged the wrong asset.
  const agglayerFaucet = canon(AGGLAYER_BALI.midenEthFaucetIdHex);

  const assets = await requestAssets();
  const byFaucet = new Map<string, bigint>();
  for (const a of assets) {
    const f = canon(a.faucetId);
    byFaucet.set(f, (byFaucet.get(f) ?? 0n) + BigInt(a.amount));
  }

  const usdcRaw = byFaucet.get(usdc) ?? 0n;
  const ethRaw = byFaucet.get(agglayerFaucet) ?? 0n;

  let agglayerEth: ResolvedEthAsset | null = null;
  if (ethRaw > 0n) {
    let decimals: number = AGGLAYER_BALI.midenEthDecimals;
    let symbol = "ETH";
    try {
      const fetched = await rpc.getAccountDetails(
        AccountId.fromHex(AGGLAYER_BALI.midenEthFaucetIdHex) as unknown,
      );
      const faucet = BasicFungibleFaucetComponent.fromAccount(fetched.account());
      decimals = faucet.decimals();
      symbol = faucet.symbol().toString();
    } catch {
      // fall back to ETH / 8dp if the faucet metadata can't be read
    }
    agglayerEth = {
      faucetId: AGGLAYER_BALI.midenEthFaucetIdHex,
      amountRaw: ethRaw,
      decimals,
      symbol,
    };
  }

  return {
    epoch: formatUnits(usdcRaw, 6),
    agglayer: agglayerEth
      ? formatUnits(agglayerEth.amountRaw, agglayerEth.decimals)
      : "0",
    agglayerEth,
  };
}
