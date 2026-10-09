import { MIDEN_ETH } from "../../core/assets";

// Outbound Miden→Sepolia (B2AGG) bridge-out constants.
//
// Cardona rollup-73 deployment confirmed by Gateway on 2026-10-09.
// See docs/agglayer-testnet.md for the deployment source. The SDK builds the B2AGG note.
export const MIDEN_BRIDGE_ID = "0x187cabbc404359d16be94954ca9879";
export const MIDEN_AGGLAYER_FAUCET_ID = MIDEN_ETH.faucetId;

// Agglayer network id of the EVM destination (Ethereum L1 / Sepolia) — used as
// the B2AGG note's destinationNetwork when bridging Miden → EVM.
export const EVM_AGGLAYER_NETWORK_ID = 0;
