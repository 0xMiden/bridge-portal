export type EvmNetwork = "sepolia" | "arc-testnet" | "base-sepolia" | "arbitrum-sepolia";
export type BridgeNetwork = EvmNetwork | "miden-testnet";

type TokenMetadata = {
  symbol: string;
  decimals: number;
};

/** Token identity includes its network and contract/faucet, never just a symbol. */
export type BridgeAsset = TokenMetadata & (
  | { network: EvmNetwork; kind: "native" }
  | { network: EvmNetwork; kind: "erc20"; address: `0x${string}` }
  | { network: "miden-testnet"; kind: "miden"; faucetId: string }
);

export type MidenAsset = Extract<BridgeAsset, { kind: "miden" }>;
export type EvmAsset = Exclude<BridgeAsset, MidenAsset>;

// Native Circle USDC. Epoch's existing Sepolia test token is a different asset.
export const CIRCLE_SEPOLIA_USDC = {
  network: "sepolia", kind: "erc20", symbol: "USDC", decimals: 6,
  address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
} as const satisfies BridgeAsset;
export const BASE_SEPOLIA_USDC = {
  network: "base-sepolia", kind: "erc20", symbol: "USDC", decimals: 6,
  address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
} as const satisfies BridgeAsset;
export const ARBITRUM_SEPOLIA_USDC = {
  network: "arbitrum-sepolia", kind: "erc20", symbol: "USDC", decimals: 6,
  address: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
} as const satisfies BridgeAsset;

export const ARC_USDC = {
  network: "arc-testnet", kind: "erc20", symbol: "USDC", decimals: 6,
  address: "0x3600000000000000000000000000000000000000",
} as const satisfies BridgeAsset;

// v0.17 testnet genesis faucet, confirmed by the deployed USDCx service.
export const MIDEN_USDCX = {
  network: "miden-testnet", kind: "miden", symbol: "USDCx", decimals: 6,
  faucetId: "0x4cbdcaffe75f0a317482224dae6436",
} as const satisfies BridgeAsset;

export const SEPOLIA_ETH = {
  network: "sepolia", kind: "native", symbol: "ETH", decimals: 18,
} as const satisfies BridgeAsset;

// The existing testnet USDC contract uses 18 decimals, unlike Miden's faucet.
export const SEPOLIA_USDC = {
  network: "sepolia", kind: "erc20", symbol: "USDC", decimals: 18,
  address: "0x2BB4FfD7E2c6D432b697554Efd77fA13bdbefd69",
} as const satisfies BridgeAsset;

export const MIDEN_ETH = {
  network: "miden-testnet", kind: "miden", symbol: "ETH", decimals: 8,
  faucetId: "0x7c6d1dc7fb7045913d524bbef017f5",
} as const satisfies BridgeAsset;

export const MIDEN_USDC = {
  network: "miden-testnet", kind: "miden", symbol: "USDC", decimals: 6,
  faucetId: "0x537c15a622074e91188aa894456c52",
} as const satisfies BridgeAsset;

export function sameAsset(left: BridgeAsset, right: BridgeAsset): boolean {
  if (left.network !== right.network || left.kind !== right.kind) return false;
  if (left.kind === "erc20" && right.kind === "erc20")
    return left.address.toLowerCase() === right.address.toLowerCase();
  if (left.kind === "miden" && right.kind === "miden")
    return left.faucetId.toLowerCase() === right.faucetId.toLowerCase();
  return left.kind === "native" && right.kind === "native";
}
