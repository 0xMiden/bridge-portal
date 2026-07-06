import { formatUnits } from "viem";
import { AGGLAYER_BALI, midenAccountToBridgeDestination } from "../agglayer";
import { type AgglayerDeposit, fetchDeposits } from "../agglayer-status";
import type { Activity } from "../bridge-state";

// AggLayer history is fully device-independent from the gateway.fm bridge-service
// `/bridges/<addr>` indexer:
//   - Sends (L2→L1): exits are indexed under the destination Sepolia address.
//   - Receives (L1→L2): deposits are indexed under the destination = the Miden
//     account's zero-padded EVM form.
// So we query by the connected Sepolia address (sends) and by the Miden account's
// EVM form (receives).

function depositStatus(d: AgglayerDeposit): Activity["status"] {
  if (d.claim_tx_hash) return "complete";
  if (d.ready_for_claim) return "claim_available";
  return "source_finality";
}

function toActivity(
  d: AgglayerDeposit,
  mode: Activity["mode"],
  evmAddress: string | undefined,
  midenAccount: string | undefined,
): Activity {
  // Bridge amounts are in the L1 token's base units (18-dp ETH).
  const amount = (() => {
    try {
      return formatUnits(BigInt(d.amount), 18);
    } catch {
      return "";
    }
  })();
  const destination =
    mode === "receive" ? "Miden" : `0x…${d.dest_addr.slice(-6)}`;
  return {
    id: `agglayer-${d.network_id}-${d.deposit_cnt}-${d.tx_hash}`,
    mode,
    provider: "agglayer",
    summary:
      mode === "receive"
        ? `Receive ${amount} ETH on Miden`
        : `Send ${amount} ETH to Sepolia`,
    status: depositStatus(d),
    eta: "",
    amount,
    asset: "ETH",
    txHash: d.tx_hash,
    sourceTxHash: d.tx_hash,
    destinationTxHash: d.claim_tx_hash || undefined,
    // block_num orders the list within this source (higher = newer).
    updatedAt: "",
    sortKey: Number(d.block_num) || 0,
    destination,
    evmAddress,
    midenAccount,
  };
}

export async function fetchAgglayerHistory({
  evmAddress,
  midenAccount,
}: {
  evmAddress?: `0x${string}`;
  midenAccount?: string;
}): Promise<Activity[]> {
  const out: Activity[] = [];

  // Sends: exits to the connected Sepolia address (origin Miden 78 → dest L1 0).
  if (evmAddress) {
    const rows = await fetchDeposits(evmAddress).catch(() => []);
    for (const d of rows) {
      if (
        d.network_id === AGGLAYER_BALI.destinationNetworkId &&
        d.dest_net === AGGLAYER_BALI.sourceNetworkId
      ) {
        out.push(toActivity(d, "send", evmAddress, midenAccount));
      }
    }
  }

  // Receives: deposits to the Miden account's EVM form (dest Miden 78).
  if (midenAccount) {
    let midenEvm: string;
    try {
      midenEvm = midenAccountToBridgeDestination(midenAccount);
    } catch {
      midenEvm = "";
    }
    if (midenEvm) {
      const rows = await fetchDeposits(midenEvm).catch(() => []);
      for (const d of rows) {
        if (d.dest_net === AGGLAYER_BALI.destinationNetworkId) {
          out.push(toActivity(d, "receive", evmAddress, midenAccount));
        }
      }
    }
  }

  return out;
}
