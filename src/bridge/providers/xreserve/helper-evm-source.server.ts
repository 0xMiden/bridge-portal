import "server-only";
import { parseAbi, parseEventLogs, type Hex, type Transaction, type TransactionReceipt } from "viem";
import type { EvmHelperServer } from "../../../config/cctp-evm-helper.server";
import { evmSourceClient } from "./helper-evm-policy.server";
import { assertEvmSourceMessage, assertEvmSourceTransaction } from "./helper-evm-validation";
import { evmSourceSchema, type EvmManualAuthorization } from "./helper-evm-types";
const messageAbi = parseAbi(["event MessageSent(bytes message)"]);
/** A failed source is final only with its exact call and canonical finalized block. */
export async function readEvmHelperSource(auth: EvmManualAuthorization, hash: Hex, server: EvmHelperServer) {
  const client = evmSourceClient(server);
  if (await client.getChainId() !== auth.deployment.source.chainId) throw new Error("Source chain mismatch.");
  const [receipt, tx, finalized] = await Promise.all([
    client.getTransactionReceipt({ hash }), client.getTransaction({ hash }), client.getBlock({ blockTag: "finalized" }),
  ]);
  assertEvmSourceTransaction(tx, auth);
  if (receipt.transactionHash.toLowerCase() !== hash || tx.hash.toLowerCase() !== hash) throw new Error("Source hash mismatch.");
  if (finalized.number === null || receipt.blockNumber > finalized.number) return { state: "pending" as const };
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  assertCanonicalSourceOccurrence(tx, receipt, block.hash);
  if (receipt.status === "reverted") return { state: "source_failed" as const, hash,
    blockNumber: receipt.blockNumber.toString(), blockHash: receipt.blockHash };
  const events = parseEventLogs({ abi: messageAbi, logs: receipt.logs.filter(log => log.address.toLowerCase() === auth.deployment.source.messageTransmitter.address) });
  if (events.length !== 1 || events[0].logIndex === null) throw new Error("Ambiguous source CCTP event.");
  assertSourceLogOccurrence(events[0], receipt);
  assertEvmSourceMessage(events[0].args.message, auth);
  const source = evmSourceSchema.parse({ sourceTransaction: hash, blockHash: receipt.blockHash, blockNumber: receipt.blockNumber.toString(),
    logIndex: events[0].logIndex, sourceAccount: auth.sourceAccount, grossAmount: auth.grossAmount,
    maxCctpFee: auth.maxCctpFee, midenRecipient: auth.midenRecipient, message: events[0].args.message });
  return { state: "source_finalized" as const, source };
}

function assertCanonicalSourceOccurrence(tx: Transaction, receipt: TransactionReceipt, blockHash: Hex | null) {
  if (blockHash !== receipt.blockHash || tx.blockHash !== receipt.blockHash) throw new Error("Source block is not canonical.");
  if (tx.blockNumber !== receipt.blockNumber || tx.transactionIndex !== receipt.transactionIndex) throw new Error("Source transaction occurrence mismatch.");
  if (receipt.from.toLowerCase() !== tx.from.toLowerCase() || receipt.to?.toLowerCase() !== tx.to?.toLowerCase()) throw new Error("Source receipt endpoints mismatch.");
}
function assertSourceLogOccurrence(log: { removed: boolean; transactionHash: Hex | null; blockHash: Hex | null; blockNumber: bigint | null; transactionIndex: number | null }, receipt: TransactionReceipt) {
  if (log.removed || log.transactionHash?.toLowerCase() !== receipt.transactionHash.toLowerCase()) throw new Error("Source log transaction mismatch.");
  if (log.blockHash !== receipt.blockHash || log.blockNumber !== receipt.blockNumber || log.transactionIndex !== receipt.transactionIndex)
    throw new Error("Source log occurrence mismatch.");
}
