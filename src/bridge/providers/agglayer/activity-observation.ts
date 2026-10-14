import type { AgglayerDeposit } from "./agglayer";
import type { Activity } from "../../core/models";

export type ChainTxObservation = {
  hash: string;
  status: "pending" | "confirmed" | "unknown";
  confirmations?: number;
  success?: boolean;
  blockNumber?: string;
};

export type AgglayerObservation = {
  sourceTx?: ChainTxObservation | null;
  destinationTx?: ChainTxObservation | null;
  deposit?: AgglayerDeposit | null;
};

/** Only chain evidence goes into a patch; the common merger owns ordering and timestamps. */
export function agglayerPatch(
  activity: Activity,
  { sourceTx, destinationTx, deposit }: AgglayerObservation,
): Partial<Activity> {
  if (sourceTx?.status === "confirmed" && sourceTx.success === false) {
    return {
      status: "failed",
      failureLeg: "source",
      eta: "Source transaction failed",
      sourceTxHash: sourceTx.hash,
    };
  }
  if (destinationTx?.status === "confirmed" && destinationTx.success === false) {
    return {
      status: "failed",
      failureLeg: "destination",
      eta: "Destination transaction failed",
      destinationTxHash: destinationTx.hash,
    };
  }
  if (activity.status === "claim_submitted" && destinationTx) {
    const confirmed = destinationTx.status === "confirmed" && destinationTx.success === true;
    return {
      status: confirmed ? "complete" : "claim_submitted",
      eta: confirmed ? "Settled on Sepolia" : "Waiting for Sepolia",
      destinationTxHash: destinationTx.hash,
      claimTxHash: destinationTx.hash,
    };
  }
  if (!deposit) {
    if (activity.mode === "send" || !sourceTx) return {};
    return {
      status: "source_finality",
      eta:
        sourceTx.status === "confirmed" && sourceTx.success === true
          ? "Sepolia confirmed, waiting for Agglayer"
          : "Waiting for Sepolia confirmation",
      sourceTxHash: sourceTx.hash,
    };
  }

  const identifiers = {
    depositCount: deposit.deposit_cnt === undefined ? undefined : String(deposit.deposit_cnt),
    destinationTxHash: deposit.claim_tx_hash || undefined,
    claimTxHash: deposit.claim_tx_hash || undefined,
  };
  if (activity.mode === "receive") {
    // A ready receive means the bridge created the Miden note. Consuming it is a separate wallet action.
    const delivered = deposit.ready_for_claim === true || Boolean(deposit.claim_tx_hash);
    return {
      ...identifiers,
      sourceTxHash: deposit.tx_hash,
      midenTxId: deposit.claim_tx_hash || undefined,
      readyForClaim: delivered,
      status: delivered ? "complete" : "message_observed",
      eta: delivered ? "Delivered — claim in your Bread wallet" : "Agglayer message observed",
    };
  }
  // A ready send still needs the Sepolia claim. Only the claimed exit proves delivery.
  const status = deposit.claim_tx_hash
    ? "complete"
    : deposit.ready_for_claim
      ? "claim_available"
      : "message_observed";
  const labels = {
    complete: "Settled on Sepolia",
    claim_available: "Ready to claim on Sepolia",
    message_observed: "Waiting for Agglayer proof",
  };
  return {
    ...identifiers,
    status,
    readyForClaim: Boolean(deposit.ready_for_claim),
    eta: labels[status],
  };
}
