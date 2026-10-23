import { createPublicClient, TransactionNotFoundError, type Hex, type Transaction } from "viem";
import type { EvmNetwork } from "../core/assets";
import { sourceTransactionSchema, type SourceTransaction } from "./source-transaction-schema";
import { evmReadTransport } from "./transport";

export type { SourceTransaction } from "./source-transaction-schema";

function sourceClient(network: EvmNetwork) {
  return createPublicClient({ transport: evmReadTransport(network) });
}

type SourceClient = ReturnType<typeof sourceClient>;

async function getTransaction(client: SourceClient, hash: string) {
  try {
    return await client.getTransaction({ hash: hash as Hex });
  } catch (error) {
    if (error instanceof TransactionNotFoundError) return undefined;
    throw error;
  }
}

function identity(tx: Transaction): SourceTransaction {
  return sourceTransactionSchema.parse({
    ...tx,
    value: tx.value.toString(),
  });
}

/** Capture the wallet's actual nonce; never guess or override it before signing. */
export async function captureSourceTransaction(network: EvmNetwork, hash: string) {
  const tx = await getTransaction(sourceClient(network), hash);
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
async function findNonceBlock(client: SourceClient, transaction: SourceTransaction) {
  const head = await client.getBlockNumber({ cacheTime: 0 });
  const countAt = (blockNumber: bigint) => client.getTransactionCount({
    address: transaction.from, blockNumber,
  });
  const nonce = transaction.nonce;
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

function replacementReason(original: SourceTransaction, replacement: Transaction): Resolution["reason"] {
  const sameCall = replacement.to?.toLowerCase() === original.to?.toLowerCase() &&
    replacement.input.toLowerCase() === original.input.toLowerCase() && replacement.value === BigInt(original.value);
  if (sameCall) return "repriced";
  const cancelled = replacement.to?.toLowerCase() === original.from.toLowerCase() &&
    replacement.input === "0x" && replacement.value === 0n;
  return cancelled ? "cancelled" : "replaced";
}

async function findReplacement(
  client: SourceClient, hash: string, transaction: SourceTransaction,
): Promise<Resolution> {
  const number = await findNonceBlock(client, transaction);
  if (number === undefined) return { transaction };
  const block = await client.getBlock({ blockNumber: number, includeTransactions: true });
  const replacement = block.transactions.find(tx =>
    tx.from.toLowerCase() === transaction.from.toLowerCase() && tx.nonce === transaction.nonce);
  if (!replacement) throw new Error("Replacement not available yet.");
  if (replacement.hash.toLowerCase() === hash.toLowerCase()) return { transaction };
  return {
    transaction, hash: replacement.hash, reason: replacementReason(transaction, replacement),
    timestamp: Number(block.timestamp) * 1000,
  };
}

/** Resolve the original or its replacement, preserving usable identity when an RPC fails. */
export async function recoverSourceTransaction(
  network: EvmNetwork, hash: string, saved?: SourceTransaction,
): Promise<Resolution> {
  let transaction: SourceTransaction | undefined;
  try {
    if (saved) transaction = sourceTransactionSchema.parse(saved);
    const client = sourceClient(network);
    const original = await getTransaction(client, hash);
    if (original) transaction = identity(original);
    if (original?.blockNumber) return { transaction }; // Provider status will handle the receipt.
    // A successful null lookup can mean the RPC has not seen the wallet's
    // broadcast yet. Without identity, there is no evidence of a replacement;
    // keep tracking the original hash and retry capture on the next poll.
    if (!transaction) return {};
    return await findReplacement(client, hash, transaction);
  } catch {
    return { transaction, warning: "Unable to check for a replacement transaction. Tracking will retry." };
  }
}
