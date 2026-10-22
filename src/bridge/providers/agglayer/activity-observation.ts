import type { AgglayerDeposit, ChainTxObservation } from "./status-schema";
import type { Activity } from "../../core/models";

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
  const network = activity.environment === "mainnet" ? "Ethereum" : "Sepolia";
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
    return claimPatch(destinationTx, network);
  }
  if (!deposit) return sourcePatch(activity, sourceTx);

  return depositPatch(activity, deposit);
}

function depositPatch(activity: Activity, deposit: AgglayerDeposit): Partial<Activity> {
  const network = activity.environment === "mainnet" ? "Ethereum" : "Sepolia";
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
      eta: delivered ? "Delivered on Miden" : "Agglayer message observed",
    };
  }
  // A ready send still needs the Sepolia claim. Only the claimed exit proves delivery.
  const status = deposit.claim_tx_hash
    ? "complete"
    : deposit.ready_for_claim
      ? "claim_available"
      : "message_observed";
  const labels = {
    complete: `Settled on ${network}`,
    claim_available: `Ready to claim on ${network}`,
    message_observed: "Waiting for Agglayer proof",
  };
  return {
    ...identifiers,
    status,
    readyForClaim: Boolean(deposit.ready_for_claim),
    eta: labels[status],
  };
}

function sourcePatch(activity: Activity, sourceTx: ChainTxObservation | null | undefined): Partial<Activity> {
  if (activity.mode === "send" || !sourceTx) return {};
  const network = activity.environment === "mainnet" ? "Ethereum" : "Sepolia";
  return {
    status: "source_finality",
    eta: sourceTx.status === "confirmed" && sourceTx.success === true
      ? `${network} confirmed, waiting for Agglayer` : `Waiting for ${network} confirmation`,
    sourceTxHash: sourceTx.hash,
  };
}

function claimPatch(destinationTx: ChainTxObservation, network: string): Partial<Activity> {
  const confirmed = destinationTx.status === "confirmed" && destinationTx.success === true;
  return {
    status: confirmed ? "complete" : "claim_submitted",
    eta: confirmed ? `Settled on ${network}` : `Waiting for ${network}`,
    destinationTxHash: destinationTx.hash,
    claimTxHash: destinationTx.hash,
  };
}
