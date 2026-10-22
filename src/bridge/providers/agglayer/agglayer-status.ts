import { agglayerConfig } from "./agglayer";

// Ported from 0xMiden/wallet@utk-bridge-integration (src/lib/agglayer/status.ts).
// Talks to the public gateway.fm bridge indexer directly — no local Rust
// backend proxy — so the claim flow works on a static/edge deploy (Cloudflare).

// `${bridgeServiceApi}/bridges` is the deposit indexer; the service root (with
// `/merkle-proof`) is one level up.


// One row from the bridge indexer's `deposits` array.
export interface AgglayerDeposit {
  leaf_type: number;
  orig_net: number;
  orig_addr: string;
  amount: string;
  dest_net: number;
  dest_addr: string;
  block_num: string;
  deposit_cnt: number;
  network_id: number;
  tx_hash: string;
  claim_tx_hash: string;
  metadata: string;
  ready_for_claim: boolean;
  global_index: string;
}

// Only the hash of one of this transaction's output-note commitments can bind
// an exit. A deposit count, recipient, amount or wallet transaction ID cannot.
export async function findMidenToEvmDeposit(
  l1Dest: string,
  exitHashes: readonly string[],
  signal?: AbortSignal,
  deploymentId?: string,
): Promise<AgglayerDeposit | null> {
  if (!exitHashes.length || exitHashes.some(hash => !/^0x[\da-f]{64}$/i.test(hash))) return null;
  const config = agglayerConfig(deploymentId);
  const expected = new Set(exitHashes.map(hash => hash.toLowerCase()));
  const limit = 100;
  let offset = 0;
  for (;;) {
    const response = await fetch(`${config.bridgeServiceApi}/bridges/${l1Dest}?limit=${limit}&offset=${offset}`, {
      cache: "no-store", signal,
    });
    if (!response.ok) throw new Error(`Agglayer bridge status ${response.status}`);
    const data: { deposits?: AgglayerDeposit[]; total_cnt?: string } = await response.json();
    const deposits = data.deposits ?? [];
    const matching = deposits.filter(d =>
      d.network_id === config.midenIndexerNetworkId && d.dest_net === config.sourceNetworkId &&
      d.dest_addr?.toLowerCase() === l1Dest.toLowerCase() && expected.has(d.tx_hash?.toLowerCase()),
    );
    if (matching.length > 1) throw new Error("Multiple exits match this withdrawal. Tracking needs verification.");
    if (matching.length === 1) return matching[0];
    offset += deposits.length;
    if (!deposits.length || offset >= Number(data.total_cnt) ||
        (data.total_cnt === undefined && deposits.length < limit)) return null;
  }
}
