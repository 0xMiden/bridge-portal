const DEFAULT_SEPOLIA_RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com";

type RpcEnv = {
  [key: string]: string | undefined;
};

export function getSepoliaRpcUrl(env: RpcEnv = process.env): string {
  return env.AGGLAYER_SEPOLIA_RPC_URL ?? env.EVM_RPC_URL ?? DEFAULT_SEPOLIA_RPC_URL;
}
