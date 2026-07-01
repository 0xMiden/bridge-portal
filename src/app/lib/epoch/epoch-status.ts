// Map Epoch intent status rows onto the bridge-portal activity state machine.
// Pure (no @miden-sdk / WASM imports) so it can be imported anywhere.
//
// Pass the *destination* chain id: MIDEN_DESTINATION_CHAIN_ID for Receive
// (EVM→Miden), the EVM chain id for Send (Miden→EVM). "Destination settled" =>
// complete. Epoch has no user claim step (the allocator sponsors the destination
// side), so there is no claim_available/claim_submitted state for Epoch.

import type { IntentTransactionStatus } from "@epoch-protocol/epoch-intents-sdk";
import type { ActivityStatus } from "../bridge-state";

const TERMINAL_OK = new Set(["success", "completed"]);
const FAILED = new Set(["failed", "reverted"]);

export function epochActivityStatus(
  statuses: readonly IntentTransactionStatus[] | undefined,
  destinationChainId: number,
): ActivityStatus {
  if (!statuses || statuses.length === 0) return "source_finality";

  if (statuses.some((s) => FAILED.has(String(s.status).toLowerCase()))) {
    return "failed";
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
  if (destSettled) return "complete";

  // In flight with observed rows.
  return "message_observed";
}
