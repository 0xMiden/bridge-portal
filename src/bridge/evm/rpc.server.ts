import { custom } from "viem";
import type { EvmNetwork } from "../core/assets";
import { evmNetworks } from "../../config/evm-networks";
import { SEPOLIA_NETWORK } from "../../config/sepolia";

// Keep private RPC configuration on the server, out of browser transports.
export function evmRpcUrls(network: EvmNetwork): string[] {
  // Provider order is explicit; read runtime secrets when a request arrives.
  const urlsByNetwork: Record<EvmNetwork, (string | undefined)[]> = {
    ethereum: [
      process.env.ETHEREUM_RPC_URL,
      // Independent public providers; viem's Merkle default rate-limits reads.
      "https://ethereum-rpc.publicnode.com",
      "https://eth.drpc.org",
    ],
    arc: [
      process.env.ARC_MAINNET_RPC_URL,
      ...evmNetworks.arc.rpcUrls.default.http,
    ],
    base: [
      process.env.BASE_RPC_URL,
      ...evmNetworks.base.rpcUrls.default.http,
    ],
    arbitrum: [
      process.env.ARBITRUM_RPC_URL,
      ...evmNetworks.arbitrum.rpcUrls.default.http,
    ],
    sepolia: [
      process.env.AGGLAYER_SEPOLIA_RPC_URL,
      process.env.EVM_RPC_URL,
      process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL,
      SEPOLIA_NETWORK.rpcUrl,
    ],
    "arc-testnet": [
      process.env.ARC_TESTNET_RPC_URL,
      ...evmNetworks["arc-testnet"].rpcUrls.default.http,
      "https://rpc.drpc.testnet.arc.io",
      "https://rpc.quicknode.testnet.arc.io",
    ],
    "base-sepolia": [
      process.env.BASE_SEPOLIA_RPC_URL,
      ...evmNetworks["base-sepolia"].rpcUrls.default.http,
      "https://base-sepolia-rpc.publicnode.com",
    ],
    "arbitrum-sepolia": [
      process.env.ARBITRUM_SEPOLIA_RPC_URL,
      ...evmNetworks["arbitrum-sepolia"].rpcUrls.default.http,
    ],
  };
  const urls = urlsByNetwork[network]
    .map((url) => url?.trim())
    .filter((url): url is string => Boolean(url));

  return [...new Set(urls)];
}

type RpcRequest = { jsonrpc: "2.0"; id: string | number; method: string; params?: unknown[] };
type RpcResponse = { jsonrpc: "2.0"; id: string | number } & (
  | { result: unknown; error?: never }
  | { error: { code: number; message: string; data?: unknown }; result?: never }
);

/** Retry transport failures, preserving contract errors for viem to decode. */
export async function forwardEvmRpc(
  network: EvmNetwork,
  body: RpcRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<RpcResponse> {
  const urls = evmRpcUrls(network);
  // Leave room within the browser's 30-second timeout even with four providers.
  const timeoutMs = Math.min(8_000, Math.floor(24_000 / urls.length));
  for (const url of urls) {
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) continue;
      const payload = await response.json();
      if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
          payload.jsonrpc !== "2.0" || payload.id !== body.id) continue;
      if (payload.error && typeof payload.error.code === "number" && typeof payload.error.message === "string") {
        // EIP-1474 availability/limit errors can arrive over HTTP 200.
        // Invalid requests and contract reverts must still reach the caller.
        if (payload.error.code === -32002 || payload.error.code === -32005) continue;
        return { jsonrpc: "2.0", id: body.id, error: payload.error };
      }
      if ("result" in payload && !("error" in payload)) return payload;
    } catch {
      // Network failure, timeout, or malformed response: try this network's next RPC.
    }
  }
  throw new Error(`${evmNetworks[network].name} RPC is temporarily unavailable. Please retry shortly.`);
}

export async function evmRpc<T>(
  network: EvmNetwork,
  method: string,
  params: unknown[],
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const payload = await forwardEvmRpc(network, { jsonrpc: "2.0", id: 1, method, params }, fetchImpl);
  if (payload.error) throw Object.assign(new Error(payload.error.message), payload.error);
  return payload.result as T;
}

export function evmServerTransport(network: EvmNetwork) {
  return custom({ request: ({ method, params }) => evmRpc(network, method, (params ?? []) as unknown[]) }, { retryCount: 0 });
}
