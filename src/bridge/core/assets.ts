import { tokenRegistry } from "../../config/token-registry";

export type EvmNetwork = "sepolia" | "arc-testnet" | "base-sepolia" | "arbitrum-sepolia" | "ethereum" | "arc" | "base" | "arbitrum";
export type MidenNetwork = "miden-testnet" | "miden-mainnet";
export type BridgeNetwork = EvmNetwork | MidenNetwork;

type TokenMetadata = {
  symbol: string;
  name?: string;
  decimals: number;
};

/** Token identity includes its network and contract/faucet, never just a symbol. */
export type BridgeAsset = TokenMetadata & (
  | { network: EvmNetwork; kind: "native" }
  | { network: EvmNetwork; kind: "erc20"; address: `0x${string}` }
  | { network: MidenNetwork; kind: "miden"; faucetId: string }
);

export type MidenAsset = Extract<BridgeAsset, { kind: "miden" }>;
export type EvmAsset = Exclude<BridgeAsset, MidenAsset>;

// Compatibility exports for faucet actions and fixtures. Values come from the same
// token connections used to build routes; no token addresses are maintained here.
function connection(routeId: string) {
  const pair = tokenRegistry.testnet.find(pair => Object.values(pair.routes).includes(routeId));
  if (!pair) throw new Error(`Unknown token connection: ${routeId}`);
  return pair;
}
function erc20<Network extends EvmNetwork>(routeId: string, network: Network) {
  const asset = connection(routeId).evm;
  if (asset.kind !== "erc20" || asset.network !== network) throw new Error(`Unexpected ERC-20 connection: ${routeId}`);
  return { ...asset, network };
}
function native(routeId: string) {
  const asset = connection(routeId).evm;
  if (asset.kind !== "native") throw new Error(`Expected native connection: ${routeId}`);
  return asset;
}

export const CIRCLE_SEPOLIA_USDC = erc20("xreserve-sepolia-usdc-to-miden", "sepolia");
export const BASE_SEPOLIA_USDC = erc20("xreserve-base-usdc-to-miden", "base-sepolia");
export const ARBITRUM_SEPOLIA_USDC = erc20("xreserve-arbitrum-usdc-to-miden", "arbitrum-sepolia");
export const ARC_USDC = erc20("xreserve-usdc-to-miden", "arc-testnet");
export const MIDEN_USDCX = connection("xreserve-usdc-to-miden").miden;
export const SEPOLIA_ETH = native("agglayer-eth-to-miden");
export const SEPOLIA_USDC = erc20("epoch-test-usdc-to-miden", "sepolia");
export const MIDEN_ETH = connection("agglayer-eth-to-miden").miden;
// Retired route remains disabled for references to older activity.
export const MIDEN_USDC = connection("epoch-usdc-to-miden").miden;
export const EPOCH_MIDEN_USDC = connection("epoch-test-usdc-to-miden").miden;
export const EPOCH_SEPOLIA_DAI = erc20("epoch-dai-to-miden", "sepolia");
export const EPOCH_MIDEN_DAI = connection("epoch-dai-to-miden").miden;
export const EPOCH_SEPOLIA_USDT = erc20("epoch-usdt-to-miden", "sepolia");
export const EPOCH_MIDEN_USDT = connection("epoch-usdt-to-miden").miden;
export const EPOCH_SEPOLIA_WBTC = erc20("epoch-wbtc-to-miden", "sepolia");
export const EPOCH_MIDEN_WBTC = connection("epoch-wbtc-to-miden").miden;

export function assetKey(asset: BridgeAsset): string {
  const identifier = asset.kind === "erc20" ? asset.address
    : asset.kind === "miden" ? asset.faucetId : "native";
  return `${asset.network}:${asset.kind}:${identifier.toLowerCase()}`;
}

export function sameAsset(left: BridgeAsset, right: BridgeAsset): boolean {
  return assetKey(left) === assetKey(right);
}
