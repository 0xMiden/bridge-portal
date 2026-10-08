import { resolveSourceTransaction } from "../../evm/source-transaction";
import { activityRoute } from "../../core/routes";
import { CCTP, isCctpNetwork } from "./cctp-config";
import type { CctpStatusResponse } from "./cctp-status";
import type { BridgeActivity } from "../../core/models";
import { normalizeMidenAccountHex } from "../agglayer/agglayer";
import type { ArcDepositIntent } from "./attestation";
import { ARC } from "./config";
import { parseArcAmount } from "./deposit";

export type ArcStatusResponse = {
  status: "submitted" | "confirmed" | "attested" | "reverted";
  deposit?: Omit<ArcDepositIntent, "nonce">;
  sourceTxAt?: number;
  intent?: ArcDepositIntent;
  warning?: string;
};

/** A terminal state cannot regress, and attestation alone is never delivery. */
export async function observeXreserveDeposit(activity: BridgeActivity, signal?: AbortSignal): Promise<{
  patch: Partial<BridgeActivity>;
  warning?: string;
}> {
  if (activity.provider !== "xreserve" || !activity.sourceTxHash ||
      activity.status === "complete" || activity.status === "failed") return { patch: {} };
  const network = activityRoute(activity)?.source.network;
  const cctp = network && isCctpNetwork(network);
  if (!network || network === "miden-testnet") throw new Error("Unknown deposit origin.");
  const fetchStatus = async (hash: string) => {
    const response = await fetch(`/api/xreserve/status?network=${network}&hash=${encodeURIComponent(hash)}`, { cache: "no-store", signal });
    const observation: CctpStatusResponse & { error?: string } = await response.json();
    if (!response.ok) throw new Error(observation.error ?? "Unable to verify this deposit. Tracking will retry.");
    return observation;
  };
  let observation = await fetchStatus(activity.sourceTxHash);
  const sourcePatch: Partial<BridgeActivity> = {};
  // Once a burn/deposit is mined, submitted can mean Circle forwarding rather
  // than an unmined source transaction. Only search for replacements before that.
  if (observation.status === "submitted" && !observation.source && !observation.deposit) {
    const resolved = await resolveSourceTransaction(network, activity.sourceTxHash, activity.sourceTransaction, signal);
    if (signal?.aborted) return { patch: {} };
    if (resolved.transaction) sourcePatch.sourceTransaction = resolved.transaction;
    if (resolved.hash) {
      sourcePatch.sourceOriginalTxHash = activity.sourceOriginalTxHash ?? activity.sourceTxHash;
      sourcePatch.sourceTxHash = resolved.hash;
      sourcePatch.sourceTxAt = resolved.timestamp;
      if (resolved.reason === "cancelled" || resolved.reason === "replaced") return {
        patch: { ...sourcePatch, status: "failed", xreserveStatus: resolved.reason },
      };
      try { observation = await fetchStatus(resolved.hash); }
      catch { return { patch: sourcePatch, warning: "Replacement found. Deposit tracking will retry with the new hash." }; }
    }
    if (resolved.warning) observation.warning = resolved.warning;
  }
  if (cctp) {
    if (observation.source && (observation.source.amount !== parseArcAmount(activity.amount).toString() ||
        observation.source.sender.toLowerCase() !== activity.evmAddress?.toLowerCase() ||
        observation.source.recipient !== `0x${normalizeMidenAccountHex(activity.midenAccountHex ?? activity.destination ?? "")}`))
      throw new Error("Circle transfer does not match the saved deposit.");
  }
  if (!["submitted", "confirmed", "attested", "reverted"].includes(observation.status)) throw new Error("Unexpected deposit status.");
  if (signal?.aborted) return { patch: {} };
  if (observation.status === "reverted") return { patch: { ...sourcePatch, status: "failed", xreserveStatus: "reverted" } };
  const stages = ["submitted", "confirmed", "attested"] as const;
  const previous = stages.indexOf(activity.xreserveStatus as typeof stages[number]);
  const stage = stages[Math.max(previous, stages.indexOf(observation.status))];
  const patch: Partial<BridgeActivity> = {
    ...sourcePatch,
    ...(observation.arcTxHash ? { xreserveArcTxHash: observation.arcTxHash } : {}),
    ...(observation.forwarding !== undefined ? { xreserveForwarding: observation.forwarding } : {}),
    xreserveStatus: stage,
    status: stage === "attested" ? "message_observed" : "source_finality",
    ...(observation.sourceTxAt ? { sourceTxAt: observation.sourceTxAt } : {}),
  };
  const intent = observation.intent;
  if (observation.status !== "attested" || !intent) return { patch, warning: observation.warning };
  if (intent.amount !== parseArcAmount(activity.amount).toString() ||
      intent.recipient !== `0x${normalizeMidenAccountHex(activity.midenAccountHex ?? activity.destination ?? "")}` ||
      intent.sender.toLowerCase() !== (cctp ? CCTP.handler.toLowerCase() : activity.evmAddress?.toLowerCase()) ||
      intent.faucet !== ARC.faucetId || !/^0x[\da-f]{64}$/i.test(intent.nonce)) {
    throw new Error("Circle attestation does not match the saved deposit. Keep the transaction hash and contact support.");
  }
  const { checkArcDelivery } = await import("./delivery");
  try {
    const delivery = await checkArcDelivery(intent);
    if (signal?.aborted) return { patch: {} };
    patch.xreserveNoteId = delivery.noteId;
    if (delivery.block !== undefined) {
      patch.xreserveMidenBlock = delivery.block;
      patch.xreserveStatus = "delivered";
      patch.status = "complete";
      patch.destinationTxAt = activity.destinationTxAt ?? Date.now();
    }
    return { patch, warning: observation.warning };
  } catch {
    return { patch, warning: "Circle attested the deposit. Miden delivery could not be checked; tracking will retry." };
  }
}
