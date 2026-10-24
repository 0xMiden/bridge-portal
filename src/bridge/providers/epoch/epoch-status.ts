// Map Epoch intent status rows onto the bridge-portal activity state machine.
// Pure (no @miden-sdk / WASM imports) so it can be imported anywhere.
//
// Pass the *destination* chain id: MIDEN_DESTINATION_CHAIN_ID for Receive
// (EVM→Miden), the EVM chain id for Send (Miden→EVM). "Destination settled" =>
// complete. Epoch has no user claim step (the allocator sponsors the destination
// side), so there is no claim_available/claim_submitted state for Epoch.

import type { IntentTransactionStatus } from "@epoch-protocol/epoch-intents-sdk";
import type { ActivityStatus } from "../../core/activity-status";

const TERMINAL_OK = new Set(["success", "completed"]);
const FAILED = new Set(["failed", "reverted"]);

export function epochActivityState(
  statuses: readonly IntentTransactionStatus[] | undefined,
  destinationChainId: number,
): { status: ActivityStatus; failureLeg?: "source" | "destination" } {
  if (!statuses || statuses.length === 0) return { status: "source_finality" };

  const failed = statuses.find((s) => FAILED.has(String(s.status).toLowerCase()));
  if (failed) {
    return {
      status: "failed",
      failureLeg: Number(failed.chainId) === destinationChainId ? "destination" : "source",
    };
  }

  // Destination-chain-aware: settled only when a destination row is terminal-OK
  // with a tx hash AND no destination row is still pending.
  const destRows = statuses.filter((s) => Number(s.chainId) === destinationChainId);
  const destPending = destRows.some((s) => String(s.status).toLowerCase() === "pending");
  const destSettled =
    !destPending &&
    destRows.some(
      (s) =>
        TERMINAL_OK.has(String(s.status).toLowerCase()) &&
        typeof s.transactionHash === "string" &&
        s.transactionHash.length > 0,
    );
  if (destSettled) return { status: "complete" };

  // In flight with observed rows.
  return { status: "message_observed" };
}

/**
 * The settled destination-chain transaction hash, once Epoch's solver has
 * fulfilled that leg — the real bridging tx (the selected EVM chain for Send, Miden for
 * Receive). Lets the detail page deep-link the explorer to the actual tx
 * instead of a tx list / a broken abbreviated hash.
 */
export function epochDestinationTx(
  statuses: readonly IntentTransactionStatus[] | undefined,
  destinationChainId: number,
): string | undefined {
  const row = statuses?.find(
    (s) =>
      Number(s.chainId) === destinationChainId &&
      TERMINAL_OK.has(String(s.status).toLowerCase()) &&
      typeof s.transactionHash === "string" &&
      s.transactionHash.length > 0,
  );
  return row?.transactionHash ?? undefined;
}
