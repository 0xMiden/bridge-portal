export type BridgeEnvironment = "testnet" | "mainnet";

export function isBridgeEnvironment(value: unknown): value is BridgeEnvironment {
  return value === "testnet" || value === "mainnet";
}

export const midenNetworks = {
  testnet: {
    network: "miden-testnet",
    rpcUrl: process.env.NEXT_PUBLIC_MIDEN_RPC_URL ?? "https://rpc.testnet.miden.io",
    explorer: "https://testnet.midenscan.com",
    addressPrefix: "mtst",
  },
  mainnet: {
    network: "miden-mainnet",
    rpcUrl: process.env.NEXT_PUBLIC_MIDEN_MAINNET_RPC_URL ?? "https://rpc.cedar.miden.io",
    explorer: "https://explorer.cedar.miden.io",
    addressPrefix: "mm",
  },
} as const;
