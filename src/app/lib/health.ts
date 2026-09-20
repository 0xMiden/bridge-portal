import { AGGLAYER_BALI } from "./agglayer";
import { EPOCH_ALLOCATOR_URL } from "./epoch/config";
import { sepoliaRpc } from "./sepolia-rpc";

export const MIDEN_RPC_URL =
  process.env.NEXT_PUBLIC_MIDEN_RPC_URL ?? "https://rpc.testnet.miden.io";

export type UpstreamName = "sepolia" | "miden" | "epoch" | "agglayer";

export type UpstreamCheck = { ok: boolean; detail: string };

export type DeepHealth = {
  ok: boolean;
  service: "miden-bridge-ui";
  checks: Record<UpstreamName, UpstreamCheck>;
};

const TIMEOUT_MS = 8_000;

async function timedFetch(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function checkSepolia(fetchImpl: typeof fetch): Promise<UpstreamCheck> {
  try {
    const chainId = await sepoliaRpc<string>("eth_chainId", [], fetchImpl);
    const ok = chainId === AGGLAYER_BALI.sepoliaChainHex;
    return {
      ok,
      detail: ok
        ? `chainId ${chainId}`
        : `expected ${AGGLAYER_BALI.sepoliaChainHex}, got ${chainId}`,
    };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkHttpUp(
  url: string,
  fetchImpl: typeof fetch,
): Promise<UpstreamCheck> {
  try {
    const response = await timedFetch(url, { method: "GET" }, fetchImpl);
    // 2xx-4xx means the process answered. 5xx / network is down.
    const ok = response.status < 500;
    return { ok, detail: `HTTP ${response.status}` };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function checkDeepHealth(
  fetchImpl: typeof fetch = fetch,
): Promise<DeepHealth> {
  const [sepolia, miden, epoch, agglayer] = await Promise.all([
    checkSepolia(fetchImpl),
    checkHttpUp(MIDEN_RPC_URL, fetchImpl),
    checkHttpUp(EPOCH_ALLOCATOR_URL, fetchImpl),
    checkHttpUp(`${AGGLAYER_BALI.bridgeServiceApi}/bridges?limit=1`, fetchImpl),
  ]);
  const checks = { sepolia, miden, epoch, agglayer };
  return {
    ok: Object.values(checks).every((check) => check.ok),
    service: "miden-bridge-ui",
    checks,
  };
}
