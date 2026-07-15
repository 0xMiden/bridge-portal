// Outbound Miden→Sepolia (B2AGG) bridge-out constants.
//
// Post-2026-06-24 rollup-78 relaunch (gateway.fm PARAMETERS.md; rollup 76/73
// are stale). The note itself is built by the SDK's `Note.createB2AggNote`
// (shipped in @miden-sdk 0.15.4 / web-sdk #211) — see lib/agglayer-execute.ts.
// bech32: bridge mcst1az3zas25lx3kmyge2074eynq5um0mm2h, faucet mcst1aqu8zjdwvcgkeug5a67kpwmnsym6qdsd
export const MIDEN_BRIDGE_ID = "0xa22ec154f9a36d911953fd5c9260a7";
export const MIDEN_AGGLAYER_FAUCET_ID = "0x387149ae66116cf114eebd60bb7381";

// Agglayer network id of the EVM destination (Ethereum L1 / Sepolia) — used as
// the B2AGG note's destinationNetwork when bridging Miden → EVM.
export const EVM_AGGLAYER_NETWORK_ID = 0;
