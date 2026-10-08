export type BridgeNetwork = "sepolia" | "miden-testnet";

type TokenMetadata = {
  symbol: string;
  decimals: number;
};

/** Token identity includes its network and contract/faucet, never just a symbol. */
export type BridgeAsset = TokenMetadata & (
  | { network: "sepolia"; kind: "native" }
  | { network: "sepolia"; kind: "erc20"; address: `0x${string}` }
  | { network: "miden-testnet"; kind: "miden"; faucetId: string }
);

export type MidenAsset = Extract<BridgeAsset, { kind: "miden" }>;

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
  faucetId: "0x387149ae66116cf114eebd60bb7381",
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
