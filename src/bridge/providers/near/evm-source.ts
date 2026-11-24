import { createPublicClient, type Hex, type PublicClient, type TransactionReceipt } from "viem";
import { isEvmAsset } from "../../core/assets";
import type { Activity } from "../../core/models";
import type { ActivityObservation } from "../../core/provider";
import { activityRoute } from "../../core/routes";
import { evmReadTransport } from "../../evm/transport";
import { findTransactionReceipt } from "../../evm/transaction-receipt";
import { recoverSourceTransaction } from "../../evm/source-transaction";

async function isFinalized(client: Pick<PublicClient, "getBlock">, receipt: TransactionReceipt, signal: AbortSignal) {
  try {
    const head = await client.getBlock({ blockTag: "finalized" });
    signal.throwIfAborted();
    if (head.number < receipt.blockNumber) return false;
    const canonical = head.number === receipt.blockNumber ? head : await client.getBlock({ blockNumber: receipt.blockNumber });
    signal.throwIfAborted();
    return canonical.hash === receipt.blockHash;
  } catch {
    signal.throwIfAborted();
    return false;
  }
}

/** While NEAR awaits an EVM deposit, retain replacements and definite source failures. */
export async function observeNearEvmSource(activity: Activity, signal: AbortSignal): Promise<ActivityObservation> {
  const asset = activityRoute(activity)?.source;
  const operation = activity.near;
  if (!isEvmAsset(asset) || !activity.sourceTxHash || !operation ||
      operation.finalizedEvmTxHash?.toLowerCase() === activity.sourceTxHash.toLowerCase()) return { patch: {} };
  const patch: Partial<Activity> = {};
  try {
    signal.throwIfAborted();
    const client = createPublicClient({ transport: evmReadTransport(asset.network, signal) });
    let hash = activity.sourceTxHash;
    let receipt = await findTransactionReceipt(client, hash as Hex);
    signal.throwIfAborted();
    let warning: string | undefined;
    let differentPayment = false;
    let replacementTime: number | undefined;
    if (!receipt) {
      const resolved = await recoverSourceTransaction(asset.network, hash, activity.sourceTransaction, signal);
      signal.throwIfAborted();
      patch.sourceTransaction = resolved.transaction;
      warning = resolved.warning;
      if (resolved.hash) {
        differentPayment = resolved.reason === "cancelled" || resolved.reason === "replaced";
        replacementTime = resolved.timestamp;
        hash = resolved.hash;
        // Track a repricing immediately. A different payment can disappear in a reorganization.
        if (!differentPayment) {
          patch.sourceOriginalTxHash = activity.sourceOriginalTxHash ?? activity.sourceTxHash;
          patch.sourceTxHash = hash;
          patch.sourceTxAt = replacementTime;
        }
        receipt = await findTransactionReceipt(client, hash as Hex);
      }
    }
    signal.throwIfAborted();
    if (receipt && receipt.transactionHash.toLowerCase() !== hash.toLowerCase()) throw new Error("Deposit receipt mismatch");
    if (receipt && !await isFinalized(client, receipt, signal)) return {
      patch, warning: differentPayment ? "A different transaction used the deposit nonce. Waiting for source-chain finality."
        : receipt.status === "reverted" ? "The EVM deposit reverted in a recent block. Waiting for source-chain finality."
        : "The EVM transaction was mined. Waiting for the source chain to finalize its outcome.",
    };
    if (receipt && differentPayment) return {
      patch: { ...patch, sourceTxHash: hash, sourceTxAt: replacementTime, sourceOriginalTxHash: activity.sourceOriginalTxHash ?? activity.sourceTxHash,
        failureLeg: "source", near: { ...operation, status: "FAILED", finalizedEvmTxHash: hash } },
      warning: "The EVM deposit was cancelled or replaced by a different transaction. No Miden delivery was confirmed.",
    };
    if (receipt?.status === "reverted") return {
      patch: { ...patch, failureLeg: "source", near: { ...operation, status: "FAILED", finalizedEvmTxHash: hash } },
      warning: "The EVM deposit reverted. No Miden delivery was confirmed.",
    };
    if (receipt?.status === "success") patch.near = { ...operation, submission: "confirmed", finalizedEvmTxHash: hash };
    return { patch, warning };
  } catch {
    signal.throwIfAborted();
    return { patch, warning: "EVM deposit confirmation is unavailable. Tracking will retry; do not send another deposit." };
  }
}
