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

// The bridge-service merkle proof for a deposit, used to claim it on L1.
export interface AgglayerMerkleProof {
  main_exit_root: string;
  rollup_exit_root: string;
  merkle_proof: string[];
  rollup_merkle_proof: string[];
}

interface MerkleProofResponse {
  proof: AgglayerMerkleProof;
}

// Base URL of the bridge service (the `/bridges` indexer path stripped off).
const BRIDGE_SERVICE_URL = BRIDGES_API.replace(/\/bridges$/, "");

// The most recent Miden→EVM (L2→L1) deposit to `l1Dest` that's ready to claim
// on L1, or null. L2-logged deposits carry `network_id === 1` in this indexer
// (the bridge-service's internal net id for the Miden rollup — distinct from the
// on-chain rollup id used as `bridgeAsset` destinationNetwork).
export async function findClaimableMidenToEvmDeposit(
  l1Dest: string,
): Promise<AgglayerDeposit | null> {
  const deposits = await fetchDeposits(l1Dest);
  const claimable = deposits
    .filter((d) => d.ready_for_claim && d.network_id === 1)
    .sort((a, b) => b.deposit_cnt - a.deposit_cnt);
  return claimable[0] ?? null;
}

// Fetch the merkle proof for a deposit (net_id is the deposit's `network_id`).
export async function fetchMerkleProof(
  depositCnt: number,
  netId: number,
): Promise<AgglayerMerkleProof> {
  const res = await fetch(
    `${BRIDGE_SERVICE_URL}/merkle-proof?deposit_cnt=${depositCnt}&net_id=${netId}`,
    { cache: "no-store" },
  );
  if (!res.ok) {
    throw new Error(`Agglayer merkle-proof status ${res.status}`);
  }
  const data: MerkleProofResponse = await res.json();
  return data.proof;
}
