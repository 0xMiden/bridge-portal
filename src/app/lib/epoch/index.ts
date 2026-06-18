// Epoch Protocol integration — ported from miden-wallet/src/lib/epoch.
//
// Present:
//   - config / types / bridgeable-token  (pure config + types)
//   - bridge.ts                          (EVM→Miden and Miden→EVM quote + intent builders)
//   - client.ts / sdk.ts                 (Epoch SDK wired to this app's wagmi v2 + AppKit)
//   - miden-note.ts                      (Miden→EVM P2IDE collateral note via the
//                                         MidenFi adapter's requestSend)
//   - chain.ts                           (current block height + native MIDEN
//                                         faucet id, read from the chain head)
//   - epoch-quote.ts / use-epoch-quote   (live forward quotes, both directions)
//   - epoch-execute.ts                   (runEpochTransfer: execute + submit both
//                                         directions; pollEpochIntentStatus helper)
//
// Wired but NOT yet runtime-verified against the live allocator. Status polling
// (pollEpochIntentStatus) is exported but not yet driven from the activity UI.

export {
  EPOCH_ALLOCATOR_URL,
  MIDEN_DESTINATION_CHAIN_ID,
  MIDEN_MIN_RECLAIM_BLOCKS,
  MIDEN_NATIVE_FAUCET_ID,
  MIDEN_NATIVE_TOKEN_DECIMALS,
  MIDEN_NATIVE_TOKEN_SYMBOL,
} from "./config";
export { getCurrentMidenBlock, getNativeMidenFaucetId } from "./chain";
export {
  createBridgeP2IDNoteCallback,
  useCreateBridgeP2IDNote,
} from "./miden-note";
export type { CreateMidenP2IDNote, MidenNoteDeps } from "./miden-note";
export { quoteEpochReceive, quoteEpochSend } from "./epoch-quote";
export type { EpochQuoteOutput } from "./epoch-quote";
export {
  runEpochTransfer,
  pollEpochIntentStatus,
  isTerminalStatus,
} from "./epoch-execute";
export type {
  EpochDirection,
  EpochExecuteResult,
  RunEpochTransferArgs,
  PollEpochStatusOpts,
} from "./epoch-execute";
export { useEpochQuote } from "./use-epoch-quote";
export type { EpochQuoteState, UseEpochQuoteOpts } from "./use-epoch-quote";
export {
  getEpochSdk,
  getEpochReadOnlySdk,
  resetEpochSdk,
  useEpochSdk,
} from "./sdk";
export {
  buildEpochWalletClient,
  buildEpochReadOnlyWalletClient,
  getEvmConnection,
} from "./client";
export type { EvmConnection } from "./client";
export {
  BRIDGEABLE_EVM_OUTPUT_TOKEN_ADDRESS,
  BRIDGEABLE_EVM_OUTPUT_TOKEN_DECIMALS,
  BRIDGEABLE_EVM_OUTPUT_TOKEN_SYMBOL,
  EPOCH_DESTINATION_CHAIN_ID,
  isBridgeableEvmTokenConfigured,
} from "./bridgeable-token";
export {
  buildEpochTaskDataParams,
  buildEVMToMidenTaskDataParams,
  buildCrossChainIntent,
  buildEVMToMidenIntent,
  formatQuoteTokenIn,
  getCrossChainQuote,
  getEVMToMidenQuote,
  normalizeMidenIdToHex,
} from "./bridge";
export type { CrossChainQuote, EVMToMidenQuote } from "./bridge";
export type {
  CrossChainIntentParams,
  EVMToMidenIntentParams,
  IntentResult,
  MidenAccount,
  MidenFaucetInfo,
  VaultAsset,
} from "./types";
