import { AGGLAYER_BALI } from "./agglayer";

// Ported from 0xMiden/wallet@utk-bridge-integration (src/lib/agglayer/status.ts).
// Talks to the public gateway.fm bridge indexer directly — no local Rust
// backend proxy — so the claim flow works on a static/edge deploy (Cloudflare).

// `${bridgeServiceApi}/bridges` is the deposit indexer; the service root (with
// `/merkle-proof`) is one level up.
const BRIDGES_API = `${AGGLAYER_BALI.bridgeServiceApi}/bridges`;

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

interface BridgesResponse {
  deposits: AgglayerDeposit[];
  total_cnt: string;
}

// Fetch recent deposits routed to `destAddr` (the destination account in EVM
// form). We pull a small window rather than just the latest so we can match our
// own deposit and not confuse it with an earlier bridge.
export async function fetchDeposits(
  destAddr: string,
  limit = 10,
): Promise<AgglayerDeposit[]> {
  const res = await fetch(`${BRIDGES_API}/${destAddr}?limit=${limit}&offset=0`, {
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Agglayer bridge status ${res.status}`);
  }
  const data: BridgesResponse = await res.json();
  return data.deposits ?? [];
}

// The Miden→EVM (L2→L1) exit to `l1Dest` through its whole lifecycle. Gateway's
// `bridge-autoclaim` claims ready exits on Sepolia automatically (no manual
// claim in this UI); when it does, `ready_for_claim` flips back to false but
// `claim_tx_hash` is populated — so we track the exit regardless of readiness
// to detect that auto-claim and settle. Per gateway.fm PARAMETERS.md a
// bridge-out is indexed with the Miden rollup as origin (`network_id === 78`,
// post rollup-78 relaunch) and Ethereum L1 as destination (`dest_net === 0`).
// Matches a known `deposit_cnt` when provided (the exact exit we're tracking),
// else the latest L2→L1 exit to this address.
export async function findMidenToEvmDeposit(
  l1Dest: string,
  depositCnt?: string | number,
): Promise<AgglayerDeposit | null> {
  const deposits = await fetchDeposits(l1Dest);
  const matching = deposits.filter(
    (d) => d.network_id === 78 && d.dest_net === 0,
  );
  if (depositCnt !== undefined) {
    const exact = matching.find(
      (d) => String(d.deposit_cnt) === String(depositCnt),
    );
    if (exact) return exact;
  }
  return matching.sort((a, b) => b.deposit_cnt - a.deposit_cnt)[0] ?? null;
}
