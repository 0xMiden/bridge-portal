import type { MidenFiWalletContextState } from "@miden-sdk/miden-wallet-adapter-react";
import type { Activity } from "../bridge-state";
import { fetchAgglayerHistory } from "./agglayer-history";
import { fetchEpochHistory } from "./epoch-history";
import { fetchMidenHistory } from "./miden-history";

// Account-derived activity list — device-independent, reconstructed from
// account-keyed sources instead of this browser's localStorage:
//   - Epoch:    getIntentStatus paginated by nonce counter (EVM address)
//   - AggLayer: gateway.fm /bridges indexer (EVM address + Miden account)
//   - Miden:    the connected wallet's notes (opt-in — opens an approval popup)
//
// Epoch + AggLayer load automatically (address-keyed, no popup). Miden is opt-in
// because reading private notes needs a wallet permission popup.

export interface FetchAccountActivityArgs {
  evmAddress?: `0x${string}`;
  midenAccount?: string;
  /** Pass to include the Miden-side history (triggers one wallet popup). */
  requestConsumableNotes?: NonNullable<
    MidenFiWalletContextState["requestConsumableNotes"]
  >;
}

export async function fetchAccountActivity({
  evmAddress,
  midenAccount,
  requestConsumableNotes,
}: FetchAccountActivityArgs): Promise<Activity[]> {
  const tasks: Promise<Activity[]>[] = [];

  if (evmAddress) {
    tasks.push(fetchEpochHistory(evmAddress).catch(() => []));
  }
  if (evmAddress || midenAccount) {
    tasks.push(
      fetchAgglayerHistory({ evmAddress, midenAccount }).catch(() => []),
    );
  }
  if (requestConsumableNotes) {
    tasks.push(
      fetchMidenHistory({ requestConsumableNotes, midenAccount }).catch(
        () => [],
      ),
    );
  }

  const all = (await Promise.all(tasks)).flat();

  // Dedup by stable per-source id.
  const seen = new Set<string>();
  const deduped = all.filter((a) => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });

  // Best-effort ordering: source-relative sortKey descending (no common
  // cross-source timestamp is available from these APIs).
  return deduped.sort((a, b) => (b.sortKey ?? 0) - (a.sortKey ?? 0));
}
