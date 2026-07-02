import { encodeFunctionData, type Hex } from "viem";
import { AGGLAYER_BALI } from "./agglayer";
import {
  type AgglayerDeposit,
  type AgglayerMerkleProof,
  fetchMerkleProof,
} from "./agglayer-status";

// Ported from 0xMiden/wallet@utk-bridge-integration
// (src/lib/agglayer/contract.ts). The wallet uses ethers' BaseContract; here we
// build the same `claimAsset` call with viem and submit it through the existing
// EIP1193 provider (`walletProvider.request({ method: "eth_sendTransaction" })`),
// matching how the bridge-portal already sends the deposit tx — no ethers dep.

const CLAIM_ASSET_ABI = [
  {
    type: "function",
    name: "claimAsset",
    stateMutability: "nonpayable",
    inputs: [
      { name: "smtProofLocalExitRoot", type: "bytes32[32]" },
      { name: "smtProofRollupExitRoot", type: "bytes32[32]" },
      { name: "globalIndex", type: "uint256" },
      { name: "mainnetExitRoot", type: "bytes32" },
      { name: "rollupExitRoot", type: "bytes32" },
      { name: "originNetwork", type: "uint32" },
      { name: "originAddress", type: "address" },
      { name: "destinationNetwork", type: "uint32" },
      { name: "destinationAddress", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "metadata", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

const ZERO_BYTES32: Hex = `0x${"00".repeat(32)}`;

// viem infers a fixed-length tuple for the `bytes32[32]` claimAsset params.
type SmtProof = readonly [
  Hex, Hex, Hex, Hex, Hex, Hex, Hex, Hex,
  Hex, Hex, Hex, Hex, Hex, Hex, Hex, Hex,
  Hex, Hex, Hex, Hex, Hex, Hex, Hex, Hex,
  Hex, Hex, Hex, Hex, Hex, Hex, Hex, Hex,
];

// SMT proofs are a fixed-size bytes32[32]; pad short proofs with zero hashes.
export function padSmtProof(proof: string[]): SmtProof {
  const padded = [...proof, ...Array<Hex>(32).fill(ZERO_BYTES32)].slice(
    0,
    32,
  );
  return padded as unknown as SmtProof;
}

export interface AgglayerClaimTransaction {
  to: string;
  data: Hex;
  value: Hex;
}

// Build the `claimAsset` transaction for a Miden→EVM (L2→L1) deposit. Mirrors
// the bridge-service claim flow: pull the merkle proof, build the two
// fixed-size SMT proof arrays, and encode the call. The caller submits it from
// the connected EVM wallet (which must be the deposit's destination address).
export async function buildAgglayerClaimTransaction(
  deposit: AgglayerDeposit,
  proofOverride?: AgglayerMerkleProof,
): Promise<AgglayerClaimTransaction> {
  const proof =
    proofOverride ??
    (await fetchMerkleProof(deposit.deposit_cnt, deposit.network_id));

  const data = encodeFunctionData({
    abi: CLAIM_ASSET_ABI,
    functionName: "claimAsset",
    args: [
      padSmtProof(proof.merkle_proof),
      padSmtProof(proof.rollup_merkle_proof),
      BigInt(deposit.global_index),
      proof.main_exit_root as Hex,
      proof.rollup_exit_root as Hex,
      deposit.orig_net,
      deposit.orig_addr as `0x${string}`,
      deposit.dest_net,
      deposit.dest_addr as `0x${string}`,
      BigInt(deposit.amount),
      (deposit.metadata && deposit.metadata !== "0x"
        ? deposit.metadata
        : "0x") as Hex,
    ],
  });

  return {
    to: AGGLAYER_BALI.sepoliaBridgeAddress,
    data,
    value: "0x0",
  };
}
