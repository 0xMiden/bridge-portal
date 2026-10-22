import { z } from "zod";
import type { EvmNetwork } from "../core/assets";
import { rpcQuantitySchema } from "./evm-schema";
import {
  rpcTransactionSchema, sourceTransactionSchema,
  type RpcTransaction, type SourceTransaction,
} from "./source-transaction-schema";

export type { SourceTransaction } from "./source-transaction-schema";

const rpcEnvelopeSchema = z.object({ result: z.unknown(), error: z.never().optional() });
const blockSchema = z.object({ timestamp: rpcQuantitySchema, transactions: z.array(rpcTransactionSchema) });

async function rpc<T>(
  network: EvmNetwork, method: string, params: unknown[], schema: z.ZodType<T>, signal?: AbortSignal,
): Promise<T> {
  const timeout = AbortSignal.timeout(30_000);
  const response = await fetch(`/api/evm/${network}/rpc`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) throw new Error("Unable to check the source transaction. Tracking will retry.");
  const body: unknown = await response.json();
  return schema.parse(rpcEnvelopeSchema.parse(body).result);
}

function identity(tx: RpcTransaction): SourceTransaction {
  return sourceTransactionSchema.parse({
    ...tx,
    nonce: Number(BigInt(tx.nonce)),
    value: BigInt(tx.value).toString(),
  });
}

/** Capture the wallet's actual nonce; never guess or override it before signing. */
export async function captureSourceTransaction(network: EvmNetwork, hash: string, signal?: AbortSignal) {
  const tx = await rpc(network, "eth_getTransactionByHash", [hash], rpcTransactionSchema.nullable(), signal);
  return tx ? identity(tx) : undefined;
}

type Resolution = {
  transaction?: SourceTransaction;
  hash?: string;
  reason?: "repriced" | "cancelled" | "replaced";
  timestamp?: number;
  warning?: string;
};

/** Find the first block whose account nonce exceeds the pending transaction's nonce. */
async function findNonceBlock(network: EvmNetwork, transaction: SourceTransaction, signal?: AbortSignal) {
  const head = BigInt(await rpc(network, "eth_blockNumber", [], rpcQuantitySchema, signal));
  const countAt = async (block: bigint) => BigInt(await rpc(
    network, "eth_getTransactionCount", [transaction.from, `0x${block.toString(16)}`], rpcQuantitySchema, signal,
  ));
  const nonce = BigInt(transaction.nonce);
  if (await countAt(head) <= nonce) return undefined; // Still pending; elapsed time never implies cancellation.
  let low = head;
  let high = head;
  // Start near the head: recent replacements should not require ancient archive state.
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
  return low;
}

function replacementReason(original: SourceTransaction, replacement: RpcTransaction): Resolution["reason"] {
  const sameCall = replacement.to?.toLowerCase() === original.to?.toLowerCase() &&
    replacement.input.toLowerCase() === original.input.toLowerCase() && BigInt(replacement.value) === BigInt(original.value);
  if (sameCall) return "repriced";
  const cancelled = replacement.to?.toLowerCase() === original.from.toLowerCase() &&
    replacement.input === "0x" && BigInt(replacement.value) === 0n;
  return cancelled ? "cancelled" : "replaced";
}

async function findReplacement(
  network: EvmNetwork, hash: string, transaction: SourceTransaction, signal?: AbortSignal,
): Promise<Resolution> {
  const number = await findNonceBlock(network, transaction, signal);
  if (number === undefined) return { transaction };
  const block = await rpc(network, "eth_getBlockByNumber", [`0x${number.toString(16)}`, true], blockSchema, signal);
  const replacement = block.transactions.find(tx =>
    tx.from.toLowerCase() === transaction.from.toLowerCase() && BigInt(tx.nonce) === BigInt(transaction.nonce));
  if (!replacement) throw new Error("Replacement not available yet.");
  if (replacement.hash.toLowerCase() === hash.toLowerCase()) return { transaction };
  return {
    transaction, hash: replacement.hash, reason: replacementReason(transaction, replacement),
    timestamp: Number(BigInt(block.timestamp)) * 1000,
  };
}

/** Resolve the original or its replacement, preserving usable identity when an RPC fails. */
export async function resolveSourceTransaction(
  network: EvmNetwork, hash: string, saved?: SourceTransaction, signal?: AbortSignal,
): Promise<Resolution> {
  let transaction: SourceTransaction | undefined;
  try {
    if (saved) transaction = sourceTransactionSchema.parse(saved);
    const original = await rpc(network, "eth_getTransactionByHash", [hash], rpcTransactionSchema.nullable(), signal);
    if (original) transaction = identity(original);
    if (original?.blockNumber) return { transaction }; // Provider status will handle the receipt.
    if (!transaction) return {
      warning: "The original transaction is unavailable. If your wallet replaced it, keep the replacement hash for recovery.",
    };
    return await findReplacement(network, hash, transaction, signal);
  } catch {
    return { transaction, warning: "Unable to check for a replacement transaction. Tracking will retry." };
  }
}
