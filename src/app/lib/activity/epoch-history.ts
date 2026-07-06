import type { Activity } from "../bridge-state";
import { epochActivityStatus } from "../epoch/epoch-status";
import { MIDEN_DESTINATION_CHAIN_ID } from "../epoch/config";
import { EPOCH_DESTINATION_CHAIN_ID } from "../epoch/bridgeable-token";
import { getEpochReadOnlySdk } from "../epoch/sdk";

// Epoch intent nonces are `(sponsorAddress << 96) | counter`, where `counter`
// is a per-account incrementing index. So an account's full Epoch history is
// reconstructable device-independently: probe counters 0,1,2,… and read each
// intent's status via `getIntentStatus(address, nonce)` — no stored state.
//
// Limitation: getIntentStatus returns only { status, transactionHash, chainId }.
// It carries no amount or explicit direction, so those are best-effort here
// (direction inferred from which chain settled; amount left blank pending a
// tx-decode enrichment pass).

const COUNTER_BITS = 96n;

export function epochNonce(evmAddress: string, counter: number): string {
  return ((BigInt(evmAddress) << COUNTER_BITS) | BigInt(counter)).toString();
}

/**
 * Reconstruct an account's Epoch intent history by paging the nonce counter.
 * Stops at the first empty counter (no intent) or after `maxProbe` probes.
 */
export async function fetchEpochHistory(
  evmAddress: `0x${string}`,
  maxProbe = 30,
): Promise<Activity[]> {
  let sdk;
  try {
    sdk = await getEpochReadOnlySdk(evmAddress);
  } catch {
    return [];
  }

  const activities: Activity[] = [];
  for (let counter = 0; counter < maxProbe; counter += 1) {
    let statuses;
    try {
      statuses = await sdk.getIntentStatus(
        evmAddress,
        epochNonce(evmAddress, counter),
      );
    } catch {
      break; // treat an error as the end of this account's intents
    }
    if (!statuses || statuses.length === 0) break; // no intent at this counter

    const status = epochActivityStatus(statuses, MIDEN_DESTINATION_CHAIN_ID);
    // Best-effort direction: if the Miden leg settled the intent it's a receive
    // (EVM→Miden); otherwise treat as a send. Neither is authoritative from the
    // status payload alone.
    const midenSettled = statuses.some(
      (s) =>
        Number(s.chainId) === MIDEN_DESTINATION_CHAIN_ID &&
        !!s.transactionHash,
    );
    const mode: Activity["mode"] = midenSettled ? "receive" : "send";
    const sepoliaTx = statuses.find(
      (s) => Number(s.chainId) === EPOCH_DESTINATION_CHAIN_ID && !!s.transactionHash,
    )?.transactionHash;

    activities.push({
      id: `epoch-${evmAddress.toLowerCase()}-${counter}`,
      mode,
      provider: "epoch",
      summary: `Epoch transfer #${counter}`,
      status,
      eta: "",
      amount: "",
      asset: "USDC",
      txHash: sepoliaTx ?? statuses[0]?.transactionHash ?? "",
      sourceTxHash: sepoliaTx,
      epochSponsor: evmAddress,
      // Counter orders the list within this source (higher = newer).
      updatedAt: "",
      sortKey: counter,
      evmAddress,
    });
  }
  return activities;
}
