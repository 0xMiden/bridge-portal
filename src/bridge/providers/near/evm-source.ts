import { createPublicClient, type Hex } from "viem";
import type { Activity } from "../../core/models";
import type { ActivityObservation } from "../../core/provider";
import { activityRoute } from "../../core/routes";
import { evmReadTransport } from "../../evm/transport";
import { findTransactionReceipt } from "../../evm/transaction-receipt";
import { recoverSourceTransaction } from "../../evm/source-transaction";

/** While NEAR awaits an EVM deposit, retain replacements and definite source failures. */
export async function observeNearEvmSource(activity: Activity, signal: AbortSignal): Promise<ActivityObservation> {
  const asset = activityRoute(activity)?.source;
  const operation = activity.near;
  if (!asset || asset.kind === "miden" || !activity.sourceTxHash || !operation || operation.submission === "confirmed") return { patch: {} };
  const patch: Partial<Activity> = {};
  try {
    const client = createPublicClient({ transport: evmReadTransport(asset.network) });
    let hash = activity.sourceTxHash;
    let receipt = await findTransactionReceipt(client, hash as Hex);
    let warning: string | undefined;
    if (!receipt) {
      const resolved = await recoverSourceTransaction(asset.network, hash, activity.sourceTransaction);
      signal.throwIfAborted();
      patch.sourceTransaction = resolved.transaction;
      warning = resolved.warning;
      if (resolved.hash) {
        patch.sourceOriginalTxHash = activity.sourceOriginalTxHash ?? hash;
        hash = patch.sourceTxHash = resolved.hash;
        patch.sourceTxAt = resolved.timestamp;
        if (resolved.reason === "cancelled" || resolved.reason === "replaced") return {
          patch: { ...patch, failureLeg: "source", near: { ...operation, status: "FAILED" } },
          warning: "The EVM deposit was cancelled or replaced by a different transaction. No Miden delivery was confirmed.",
        };
        receipt = await findTransactionReceipt(client, hash as Hex);
      }
    }
    signal.throwIfAborted();
    if (receipt && receipt.transactionHash.toLowerCase() !== hash.toLowerCase()) throw new Error("Deposit receipt mismatch");
    if (receipt?.status === "reverted") return {
      patch: { ...patch, failureLeg: "source", near: { ...operation, status: "FAILED" } },
      warning: "The EVM deposit reverted. No Miden delivery was confirmed.",
    };
    if (receipt) patch.near = { ...operation, submission: "confirmed" };
    return { patch, warning };
  } catch {
    signal.throwIfAborted();
    return { patch, warning: "EVM deposit confirmation is unavailable. Tracking will retry; do not send another deposit." };
  }
}
