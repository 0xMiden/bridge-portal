export const PUBLICNODE_SEPOLIA_RPC =
  "https://ethereum-sepolia-rpc.publicnode.com";

/** First non-empty of AGGLAYER_SEPOLIA_RPC_URL, EVM_RPC_URL, publicnode. */
export function sepoliaRpcUrl(
  env: NodeJS.Dict<string | undefined> = process.env,
): string {
  const primary = env.AGGLAYER_SEPOLIA_RPC_URL?.trim();
  const fallback = env.EVM_RPC_URL?.trim();
  return primary || fallback || PUBLICNODE_SEPOLIA_RPC;
}

export async function sepoliaRpc<T>(
  method: string,
  params: unknown[],
  fetchImpl: typeof fetch = fetch,
  env: NodeJS.Dict<string | undefined> = process.env,
): Promise<T> {
  const response = await fetchImpl(sepoliaRpcUrl(env), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    next: { revalidate: 0 },
  } as RequestInit);

  if (!response.ok) {
    throw new Error(`Sepolia RPC returned ${response.status}.`);
  }

  const payload = (await response.json()) as {
    result?: T;
    error?: { message?: string };
  };
  if (payload.error) {
    throw new Error(payload.error.message ?? "Sepolia RPC returned an error.");
  }
  if (payload.result === undefined) {
    throw new Error("Sepolia RPC did not return a result.");
  }
  return payload.result;
}
