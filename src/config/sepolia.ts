// Network metadata shared by wallet connection and bridge integrations.
// Callers apply their own environment overrides to the default RPC URL.
export const SEPOLIA_NETWORK = {
  chainId: 11155111,
  chainHex: "0xaa36a7",
  rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
  explorerUrl: "https://sepolia.etherscan.io",
} as const;
