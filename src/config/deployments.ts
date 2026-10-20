import snapshots from "./wallet-config/snapshots.json";
import { midenNetworks, type BridgeEnvironment } from "./environment";
import type { EvmNetwork } from "../bridge/core/assets";

type Address = `0x${string}`;
export type AgglayerToken = {
  symbol: string;
  name: string;
  address: Address;
  decimals: number;
  faucetId: string;
  midenDecimals: number;
};
export type WalletBridge = {
  depositEnabled: boolean;
  withdrawalEnabled: boolean;
  contractAddress?: Address;
  midenBridgeId?: string;
  domain?: number;
  tokens?: { USDC: { contractAddress: Address; outputs?: string[] } };
  deposit?: {
    route: "xreserve" | "executor";
    xReserve?: Address;
    executorChain?: EvmNetwork;
    tokenMessenger?: Address;
    tokenMessengerWithFees?: Address;
  };
  executor?: { address: Address; handler: Address };
};

export type BridgeDeployment = {
  id: string;
  revision: string;
  environment: BridgeEnvironment;
  document: {
    version: number;
    features: { fastBridge?: boolean; bridgeIn?: boolean; bridgeOut?: boolean };
    "bridge-providers": {
      agglayer: { indexerUrl: string };
      usdcx: { midenDomain: number; attestationUrl: string; irisUrl: string };
      epoch?: { allocatorUrl: string; outputs?: Record<string, { faucetId: string }> };
    };
    supportedEvmChains: Partial<Record<EvmNetwork, {
      chainId: number;
      bridges: { agglayer?: WalletBridge; usdcx?: WalletBridge; epoch?: WalletBridge };
    }>>;
  };
  derived: {
    rpcUrl: string;
    rollupId: number;
    eth: { faucetId: string; decimals: number };
    usdcxFaucetId: string;
    agglayerTokens?: AgglayerToken[];
  };
};

// Imported from a reviewed commit by scripts/sync-wallet-config.mjs. Appending
// snapshots preserves the configuration used by transfers from earlier releases.
const deployments = snapshots as unknown as readonly BridgeDeployment[];
export const legacyTestnetDeployment = deployments.find(value => value.environment === "testnet")!;

export function currentDeployment(environment: BridgeEnvironment): BridgeDeployment {
  const deployment = deployments.findLast(value => value.environment === environment);
  if (!deployment) throw new Error(`No ${environment} deployment is configured.`);
  return deployment;
}

/** API inputs select an allowlisted deployment, never an arbitrary service URL. */
export function getDeployment(id = legacyTestnetDeployment.id): BridgeDeployment {
  const deployment = deployments.find(value => value.id === id);
  if (!deployment) throw new Error("Unknown bridge deployment.");
  return deployment;
}

export function deploymentMiden(id?: string) {
  const deployment = getDeployment(id);
  const override = deployment.environment === "mainnet" ? process.env.NEXT_PUBLIC_MIDEN_MAINNET_RPC_URL : process.env.NEXT_PUBLIC_MIDEN_RPC_URL;
  return { ...midenNetworks[deployment.environment], rpcUrl: override ?? deployment.derived.rpcUrl };
}

export function deploymentEvmNetwork(id?: string): EvmNetwork {
  return getDeployment(id).environment === "mainnet" ? "ethereum" : "sepolia";
}

export function deploymentArcNetwork(id?: string): "arc" | "arc-testnet" {
  return getDeployment(id).environment === "mainnet" ? "arc" : "arc-testnet";
}

export function assertDeploymentNetwork(id: string | undefined, network: EvmNetwork) {
  if (!getDeployment(id).document.supportedEvmChains[network]) throw new Error("Network does not belong to this deployment.");
}
