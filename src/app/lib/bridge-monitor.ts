import type { AgglayerDeposit } from "./agglayer";
import type { Activity } from "./bridge-state";

export const sourceTxPollMs = 6_000;
export const agglayerPollMs = 10_000;

export type ChainTxObservation = {
  hash: string;
  status: "pending" | "confirmed" | "unknown";
  confirmations?: number;
  success?: boolean;
  blockNumber?: string;
};

export type ClaimPlanObservation = {
  readyForClaim: boolean;
  depositCount?: string | number;
};

export type BridgeMonitorObservation = {
  checkedAt: string;
  sourceTx?: ChainTxObservation | null;
  destinationTx?: ChainTxObservation | null;
  agglayerDeposit?: AgglayerDeposit | null;
  claimPlan?: ClaimPlanObservation | null;
};

function isFailedTx(tx?: ChainTxObservation | null) {
  return tx?.status === "confirmed" && tx.success === false;
}

function isSuccessfulTx(tx?: ChainTxObservation | null) {
  return tx?.status === "confirmed" && tx.success === true;
}

function depositCount(value: AgglayerDeposit | ClaimPlanObservation | null | undefined) {
  if (!value) return undefined;
  if ("deposit_cnt" in value && value.deposit_cnt !== undefined) return String(value.deposit_cnt);
  if ("depositCount" in value && value.depositCount !== undefined) return String(value.depositCount);
  return undefined;
}

export function deriveMonitoredActivity(activity: Activity, observation: BridgeMonitorObservation): Activity {
  let next: Activity = { ...activity, updatedAt: observation.checkedAt };

  if (isFailedTx(observation.sourceTx)) {
    return {
      ...next,
      status: "failed",
      eta: "Source transaction failed",
      sourceTxHash: observation.sourceTx?.hash ?? next.sourceTxHash,
    };
  }

  if (isFailedTx(observation.destinationTx)) {
    return {
      ...next,
      status: "failed",
      eta: "Destination transaction failed",
      destinationTxHash: observation.destinationTx?.hash ?? next.destinationTxHash,
    };
  }

  if (next.status === "claim_submitted" && observation.destinationTx) {
    if (isSuccessfulTx(observation.destinationTx)) {
      return {
        ...next,
        status: "complete",
        eta: "Settled on Sepolia",
        destinationTxHash: observation.destinationTx.hash,
        claimTxHash: observation.destinationTx.hash,
      };
    }

    return {
      ...next,
      eta: "Waiting for Sepolia",
      destinationTxHash: observation.destinationTx.hash,
      claimTxHash: observation.destinationTx.hash,
    };
  }

  if (next.provider !== "agglayer") return next;

  if (next.mode === "receive") {
    if (observation.sourceTx && !isSuccessfulTx(observation.sourceTx)) {
      return {
        ...next,
        status: "source_finality",
        eta: "Waiting for Sepolia confirmation",
        sourceTxHash: observation.sourceTx.hash,
      };
    }

    if (isSuccessfulTx(observation.sourceTx) && observation.agglayerDeposit === null) {
      next = {
        ...next,
        status: "source_finality",
        eta: "Sepolia confirmed, waiting for AggLayer",
        sourceTxHash: observation.sourceTx?.hash ?? next.sourceTxHash,
      };
    }

    if (observation.agglayerDeposit) {
      const deposit = observation.agglayerDeposit;
      // Two distinct "claims" for a Sepolia→Miden receive:
      //   1. AggLayer destination claim — the bridge auto-creates the note on
      //      Miden. Signalled by `claim_tx_hash` (the note-creation tx) +
      //      `ready_for_claim`. After this the note EXISTS in the wallet.
      //   2. Miden note claim — the user consumes that note in MidenFi to
      //      reflect the balance. Happens in-wallet and the deposit indexer
      //      can't observe it (private note), so delivery IS the app's terminal
      //      success state: once the note is created the bridge has done its job
      //      and the remaining consume is the user's to perform in their wallet.
      const noteCreated =
        deposit.ready_for_claim === true || Boolean(deposit.claim_tx_hash);
      const shared = {
        ...next,
        readyForClaim: noteCreated,
        depositCount: depositCount(deposit) ?? next.depositCount,
        sourceTxHash: deposit.tx_hash ?? next.sourceTxHash,
        txHash: deposit.tx_hash ?? next.txHash,
      };
      if (noteCreated) {
        return {
          ...shared,
          status: "complete",
          eta: "Delivered — claim in your Miden wallet",
          // The AggLayer destination claim tx = the Miden note-creation tx.
          midenTxId: deposit.claim_tx_hash ?? next.midenTxId,
          destinationTxHash: deposit.claim_tx_hash ?? next.destinationTxHash,
          claimTxHash: deposit.claim_tx_hash ?? next.claimTxHash,
        };
      }
      return {
        ...shared,
        status: "message_observed",
        eta: "AggLayer message observed",
      };
    }

    return next;
  }

  if (observation.claimPlan) {
    if (observation.claimPlan.readyForClaim) {
      return {
        ...next,
        status: "claim_available",
        eta: "Ready to claim on Sepolia",
        readyForClaim: true,
        depositCount: depositCount(observation.claimPlan) ?? next.depositCount,
      };
    }

    if (next.status === "source_finality" || next.status === "message_observed") {
      return {
        ...next,
        status: "message_observed",
        eta: "Waiting for AggLayer proof",
        readyForClaim: false,
      };
    }
  }

  return next;
}
