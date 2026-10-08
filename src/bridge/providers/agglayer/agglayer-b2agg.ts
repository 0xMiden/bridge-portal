import { MIDEN_ETH } from "../../core/assets";

// Outbound Miden→Sepolia (B2AGG) bridge-out constants.
//
// Current rollup-86 deployment, verified against 0xMiden/wallet
// src/lib/agglayer/b2agg/constant.ts. The SDK builds the B2AGG note.
export const MIDEN_BRIDGE_ID = "0x3b66e20b5088f25133b69216484652";
export const MIDEN_AGGLAYER_FAUCET_ID = MIDEN_ETH.faucetId;

// Agglayer network id of the EVM destination (Ethereum L1 / Sepolia) — used as
// the B2AGG note's destinationNetwork when bridging Miden → EVM.
export const EVM_AGGLAYER_NETWORK_ID = 0;
