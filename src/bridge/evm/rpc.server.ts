import { custom } from "viem";
import type { EvmNetwork } from "../core/assets";
import { evmNetworks } from "../../config/evm-networks";
import { SEPOLIA_NETWORK } from "../../config/sepolia";

// Keep private RPC configuration on the server, out of browser transports.
export function evmRpcUrls(network: EvmNetwork): string[] {
  const urls = network === "sepolia"
    ? [process.env.AGGLAYER_SEPOLIA_RPC_URL, process.env.EVM_RPC_URL,
        process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL, SEPOLIA_NETWORK.rpcUrl]
    : network === "arc-testnet"
      ? [...evmNetworks[network].rpcUrls.default.http,
          "https://rpc.drpc.testnet.arc.io", "https://rpc.quicknode.testnet.arc.io"]
      : evmNetworks[network].rpcUrls.default.http;
  return [...new Set(urls.map((url) => url?.trim()).filter((url): url is string => Boolean(url)))];
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
  for (const url of evmRpcUrls(network)) {
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) continue;
      const payload = await response.json();
      if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
          payload.jsonrpc !== "2.0" || payload.id !== body.id) continue;
      if (payload.error && typeof payload.error.code === "number" && typeof payload.error.message === "string")
        return { jsonrpc: "2.0", id: body.id, error: payload.error };
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
