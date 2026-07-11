// One-knob environment config for the harness side (§3.1 of the design doc).
// The matched SUT-side value is baked into the app build as NEXT_PUBLIC_E2E_*
// by the Playwright webServer, so build and harness can't drift.

export type E2ENetwork = "testnet" | "mock";

export interface EnvironmentConfig {
  name: E2ENetwork;
  /** Sepolia (EVM source/destination chain). */
  sepoliaRpcUrl: string;
  sepoliaChainId: number;
  /** The Epoch bridgeable test USDC on Sepolia (public mint). */
  usdcAddress: `0x${string}`;
  usdcDecimals: number;
  /** Miden testnet endpoints (for the miden-client counterparty driver). */
  midenRpcUrl: string;
  midenTransportUrl: string;
  midenNetworkFlag: string;
  /** AggLayer / Gateway-FM deposit indexer (bridge observation reads). */
  agglayerBridgeApi: string;
  /** Funding floors/amounts used by global-setup (base units where noted). */
  funding: {
    sepoliaEthFloorWei: bigint;
    usdcMintAmount: bigint; // 18-dp USDC
  };
  pollIntervalMs: number;
  txTimeoutMs: number;
}

const ENVIRONMENTS: Record<E2ENetwork, EnvironmentConfig> = {
  testnet: {
    name: "testnet",
    sepoliaRpcUrl:
      process.env.E2E_SEPOLIA_RPC_URL ??
      "https://ethereum-sepolia-rpc.publicnode.com",
    sepoliaChainId: 11155111,
    usdcAddress: "0x2BB4FfD7E2c6D432b697554Efd77fA13bdbefd69",
    usdcDecimals: 18,
    midenRpcUrl: "https://rpc.testnet.miden.io",
    midenTransportUrl: "https://transport.miden.io",
    midenNetworkFlag: "testnet",
    agglayerBridgeApi:
      "https://miden-testnet-bridge.dev.eu-north-3.gateway.fm/api",
    funding: {
      sepoliaEthFloorWei: 5_000_000_000_000_000n, // 0.005 ETH
      usdcMintAmount: 100_000_000_000_000_000_000n, // 100 USDC (18-dp)
    },
    pollIntervalMs: 5_000,
    txTimeoutMs: 180_000,
  },
  // The mock tier needs no real endpoints (MSW intercepts /api and RPC), but the
  // shape is kept identical so specs/fixtures don't branch on network.
  mock: {
    name: "mock",
    sepoliaRpcUrl: "http://127.0.0.1:65535/mock-rpc",
    sepoliaChainId: 11155111,
    usdcAddress: "0x2BB4FfD7E2c6D432b697554Efd77fA13bdbefd69",
    usdcDecimals: 18,
    midenRpcUrl: "http://127.0.0.1:65535/mock-miden",
    midenTransportUrl: "http://127.0.0.1:65535/mock-transport",
    midenNetworkFlag: "testnet",
    agglayerBridgeApi: "http://127.0.0.1:65535/mock-agglayer",
    funding: { sepoliaEthFloorWei: 0n, usdcMintAmount: 0n },
    pollIntervalMs: 500,
    txTimeoutMs: 30_000,
  },
};

export function getEnvironmentConfig(): EnvironmentConfig {
  const name = (process.env.E2E_NETWORK ?? "testnet") as E2ENetwork;
  const config = ENVIRONMENTS[name];
  if (!config) {
    throw new Error(
      `Unknown E2E_NETWORK="${name}". Valid: ${Object.keys(ENVIRONMENTS).join(", ")}`,
    );
  }
  return config;
}

export function isMockRun(): boolean {
  return (process.env.E2E_NETWORK ?? "testnet") === "mock";
}
