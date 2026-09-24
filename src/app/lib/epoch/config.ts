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
 * Miden-side token for the Epoch route = USDC (Epoch's SIO route is USDC<->USDC).
 *
 * Miden 0.16 testnet USDC faucet, verified against Epoch's live quote API.
 * Source: epochprotocol/epoch-user-dashboard, src/constants/miden-faucets.ts.
 * The supported-chains documentation still lists the retired faucet, which
 * causes NO_QUOTE_AVAILABLE. This asset uses 6 decimals.
 *
 * NOTE: the `MIDEN_NATIVE_*` names are legacy; this is the USDC faucet, not the
 * chain-native asset.
 */
export const MIDEN_NATIVE_TOKEN_SYMBOL = "USDC";
export const MIDEN_NATIVE_TOKEN_DECIMALS = 6;
export const MIDEN_NATIVE_FAUCET_ID = "0x537c15a622074e91188aa894456c52";
