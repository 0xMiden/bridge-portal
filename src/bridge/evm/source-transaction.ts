import type { EvmNetwork } from "../core/assets";

/** Persisted independently of the hash, which changes when a wallet reprices. */
export type SourceTransaction = {
  hash: string;
  from: string;
  nonce: number;
  to: string | null;
  input: string;
  value: string;
};

type RpcTransaction = Omit<SourceTransaction, "nonce"> & { nonce: string; blockNumber: string | null };

async function rpc<T>(network: EvmNetwork, method: string, params: unknown[], signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/evm/${network}/rpc`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
  });
  const body = await response.json();
  if (!response.ok || body.error || !("result" in body)) throw new Error("Unable to check the source transaction. Tracking will retry.");
  return body.result;
}

function identity(tx: RpcTransaction): SourceTransaction {
  const nonce = Number(BigInt(tx.nonce));
  if (!Number.isSafeInteger(nonce) || nonce < 0) throw new Error("Invalid transaction nonce.");
  return { hash: tx.hash, from: tx.from, nonce, to: tx.to, input: tx.input, value: BigInt(tx.value).toString() };
}

/** Capture the wallet's actual nonce; never guess or override it before signing. */
export async function captureSourceTransaction(network: EvmNetwork, hash: string, signal?: AbortSignal) {
  const tx = await rpc<RpcTransaction | null>(network, "eth_getTransactionByHash", [hash], signal);
  return tx ? identity(tx) : undefined;
}

type Resolution = {
  transaction?: SourceTransaction;
  hash?: string;
  reason?: "repriced" | "cancelled" | "replaced";
  timestamp?: number;
  warning?: string;
};

/** Find the block that consumed this nonce, even after a long absence/reload. */
export async function resolveSourceTransaction(
  network: EvmNetwork, hash: string, saved?: SourceTransaction, signal?: AbortSignal,
): Promise<Resolution> {
  let transaction = saved;
  try {
    const original = await rpc<RpcTransaction | null>(network, "eth_getTransactionByHash", [hash], signal);
    if (original) transaction = identity(original);
    if (original?.blockNumber) return { transaction }; // Provider status will handle the receipt.
    if (!transaction) return { warning: "The original transaction is unavailable. If your wallet replaced it, keep the replacement hash for recovery." };
    const head = BigInt(await rpc<string>(network, "eth_blockNumber", [], signal));
    const countAt = async (block: bigint) => BigInt(await rpc<string>(network, "eth_getTransactionCount", [transaction!.from, `0x${block.toString(16)}`], signal));
    const nonce = BigInt(transaction.nonce);
    if (await countAt(head) <= nonce) return { transaction }; // Still pending; never infer cancellation from elapsed time.
    let low = head;
    let high = head;
    // Start near the head so recent replacements do not require ancient state
    // from a non-archive RPC. Widen only when this nonce was mined further back.
    for (let distance = 1n; low > 0n; distance *= 2n) {
      low = head > distance ? head - distance : 0n;
      if (await countAt(low) <= nonce) break;
      high = low;
    }
    // Logarithmic historical reads instead of scanning every block since broadcast.
    while (low < high) {
      const middle = (low + high) / 2n;
      if (await countAt(middle) > nonce) high = middle;
      else low = middle + 1n;
    }
    const block = await rpc<{ timestamp: string; transactions: RpcTransaction[] }>(network, "eth_getBlockByNumber", [`0x${low.toString(16)}`, true], signal);
    const replacement = block.transactions.find((tx) => tx.from.toLowerCase() === transaction!.from.toLowerCase() && BigInt(tx.nonce) === nonce);
    if (!replacement) throw new Error("Replacement not available yet.");
    if (replacement.hash.toLowerCase() === hash.toLowerCase()) return { transaction };
    const sameCall = replacement.to?.toLowerCase() === transaction.to?.toLowerCase() &&
      replacement.input.toLowerCase() === transaction.input.toLowerCase() && BigInt(replacement.value) === BigInt(transaction.value);
    const cancelled = replacement.to?.toLowerCase() === transaction.from.toLowerCase() &&
      replacement.input === "0x" && BigInt(replacement.value) === 0n;
    return { transaction, hash: replacement.hash, reason: sameCall ? "repriced" : cancelled ? "cancelled" : "replaced",
      timestamp: Number(BigInt(block.timestamp)) * 1000 };
  } catch {
    // Preserve newly discovered nonce data even when a historical RPC read fails.
    return { transaction, warning: "Unable to check for a replacement transaction. Tracking will retry." };
  }
}
