export type EvmNetwork = "sepolia" | "arc-testnet" | "base-sepolia" | "arbitrum-sepolia";
export type BridgeNetwork = EvmNetwork | "miden-testnet";

type TokenMetadata = {
  symbol: string;
  name?: string;
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
  name: "Circle USDC",
  network: "sepolia", kind: "erc20", symbol: "USDC", decimals: 6,
  address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
} as const satisfies BridgeAsset;
export const BASE_SEPOLIA_USDC = {
  name: "Circle USDC",
  network: "base-sepolia", kind: "erc20", symbol: "USDC", decimals: 6,
  address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
} as const satisfies BridgeAsset;
export const ARBITRUM_SEPOLIA_USDC = {
  name: "Circle USDC",
  network: "arbitrum-sepolia", kind: "erc20", symbol: "USDC", decimals: 6,
  address: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
} as const satisfies BridgeAsset;

export const ARC_USDC = {
  name: "Circle USDC",
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
  name: "Epoch test USDC",
  network: "sepolia", kind: "erc20", symbol: "USDC", decimals: 18,
  address: "0x2BB4FfD7E2c6D432b697554Efd77fA13bdbefd69",
} as const satisfies BridgeAsset;

export const MIDEN_ETH = {
  network: "miden-testnet", kind: "miden", symbol: "ETH", decimals: 8,
  faucetId: "0x7c6d1dc7fb7045913d524bbef017f5",
} as const satisfies BridgeAsset;

// Retired v0.16 Epoch faucet, retained for saved activity receipts.
export const MIDEN_USDC = {
  network: "miden-testnet", kind: "miden", symbol: "USDC", decimals: 6,
  faucetId: "0x537c15a622074e91188aa894456c52",
} as const satisfies BridgeAsset;

// Current v0.17 faucets from https://userdashboard.epochprotocol.xyz/faucets.
// Positive allocator quotes verified in both directions on 2026-10-20.
// These mocks have 18 decimals on Sepolia and 6 on Miden (including WBTC).
export const EPOCH_MIDEN_USDC = {
  name: "Epoch test USDC",
  network: "miden-testnet", kind: "miden", symbol: "USDC", decimals: 6,
  faucetId: "0x5b043dcb48d5721106f7a1ceb2b804",
} as const satisfies BridgeAsset;
export const EPOCH_SEPOLIA_DAI = {
  name: "Epoch test DAI",
  network: "sepolia", kind: "erc20", symbol: "DAI", decimals: 18,
  address: "0xc30f1Ce05d1434d484E9A47283aA925fc8A8699a",
} as const satisfies BridgeAsset;
export const EPOCH_MIDEN_DAI = {
  name: "Epoch test DAI",
  network: "miden-testnet", kind: "miden", symbol: "DAI", decimals: 6,
  faucetId: "0xd41499b8f142ad9119fd9da357a3b2",
} as const satisfies BridgeAsset;
export const EPOCH_SEPOLIA_USDT = {
  name: "Epoch test USDT",
  network: "sepolia", kind: "erc20", symbol: "USDT", decimals: 18,
  address: "0xc04d2869665Be874881133943523723Be5782720",
} as const satisfies BridgeAsset;
export const EPOCH_MIDEN_USDT = {
  name: "Epoch test USDT",
  network: "miden-testnet", kind: "miden", symbol: "USDT", decimals: 6,
  faucetId: "0x0ead4362a745e7d1790d75ea779611",
} as const satisfies BridgeAsset;
export const EPOCH_SEPOLIA_WBTC = {
  name: "Epoch test WBTC",
  network: "sepolia", kind: "erc20", symbol: "WBTC", decimals: 18,
  address: "0x9b2a2754a9182fD65360E23afCDf3BeFF51796E9",
} as const satisfies BridgeAsset;
export const EPOCH_MIDEN_WBTC = {
  name: "Epoch test WBTC",
  network: "miden-testnet", kind: "miden", symbol: "WBTC", decimals: 6,
  faucetId: "0x1b22d80328f58c5171f67a85f170a3",
} as const satisfies BridgeAsset;

export function assetKey(asset: BridgeAsset): string {
  const identifier = asset.kind === "erc20" ? asset.address
    : asset.kind === "miden" ? asset.faucetId : "native";
  return `${asset.network}:${asset.kind}:${identifier.toLowerCase()}`;
}

export function sameAsset(left: BridgeAsset, right: BridgeAsset): boolean {
  return assetKey(left) === assetKey(right);
}
