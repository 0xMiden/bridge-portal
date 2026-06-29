/**
 * Epoch Protocol integration config.
 *
 * Ported from miden-wallet/src/lib/epoch/config.ts and adapted for this app.
 * Epoch handles cross-chain intents between the user's EVM wallet (connected
 * here via AppKit / wagmi) and the Miden chain. This app is the dApp / intent
 * submitter; the allocator is hosted by Epoch.
 */

export const EPOCH_ALLOCATOR_URL =
  process.env.NEXT_PUBLIC_EPOCH_ALLOCATOR_URL ??
  "https://testnet-dev.epochprotocol.xyz";

/**
 * Virtual chain id used by the SDK when an intent's origin / destination
 * is the Miden chain. The walletClient's `chain.id` must be temporarily set
 * to this value when calling solveIntent for a Miden→EVM flow. See:
 * https://docs.epochprotocol.xyz/epoch-miden-integration/integration-guide
 */
export const MIDEN_DESTINATION_CHAIN_ID = 999999999;

/**
 * Minimum reclaim window (in Miden blocks) for the P2IDE collateral note on a
 * Miden→EVM send, per Epoch's docs. Used two ways that must agree:
 *  - as the RELATIVE `recallBlocks` passed to the wallet's send (the note
 *    becomes reclaimable `delta` blocks after it commits), and
 *  - as the ABSOLUTE `midenReclaimHeight` (`currentBlock + delta`) declared in
 *    the intent task data. A stale/too-small value makes the note reclaimable
 *    at creation and the intent fails.
 */
export const MIDEN_MIN_RECLAIM_BLOCKS = 1000;

/**
 * The Miden-side token for the Epoch route is fixed to the chain's NATIVE asset
 * (MIDEN), never the bridged Miden-ETH faucet. Symbol/decimals are chain-truth
 * constants (the native faucet always reports `MIDEN` / 6 dp).
 *
 * `MIDEN_NATIVE_FAUCET_ID` is pinned to a literal here. `getNativeMidenFaucetId()`
 * returns it directly when set; leave it blank to fall back to reading it from
 * the chain head (`BlockHeader.nativeAssetId()`) instead.
 */
// Miden-side bridge token = USDC on Miden testnet (Epoch's SIO route is USDC<->USDC).
// Faucet id refreshed for the v0.15 testnet genesis — the old 0.14-era id
// (0x0a7d175ed63ec5200fb2ced86f6aa5) no longer resolves and the allocator returns
// "A quote isn't available". Current value from epochprotocol/miden-integration-example
// (constants/miden-tokens.ts). 6 decimals.
export const MIDEN_NATIVE_TOKEN_SYMBOL = "USDC";
export const MIDEN_NATIVE_TOKEN_DECIMALS = 6;
export const MIDEN_NATIVE_FAUCET_ID = "0x2458e5446128e6b150b75b8ebd9ce1";
