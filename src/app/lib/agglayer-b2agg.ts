// Outbound Miden→Sepolia (B2AGG) constants and note builder.
//
// Ported from 0xMiden/wallet@utk-bridge-integration
// (src/lib/agglayer/b2agg/{constant,index}.ts). The whole B2AGG note — script,
// NetworkAccountTarget attachment, 6 input felts, and the fungible asset — is
// built by a SINGLE SDK factory, `Note.createB2AggNote(...)`. That method is
// NOT in any published `@miden-sdk/miden-sdk` (0.14.x–0.15.3; only
// createP2IDNote / createP2IDENote ship). The wallet branch links an
// unreleased/forked SDK build. Until it's published, the send path throws.
//
// Why we can't hand-roll it on the published SDK: a B2AGG note is
// {custom B2AGG script + NetworkAccountTarget attachment}. The script compiles
// fine client-side (Assembler.compileNoteScript / NoteScript.deserialize) and
// the attachment word is buildable (NoteAttachment.fromWord), but there is NO
// JS API to attach an attachment to a custom-script note: on the 0.15 surface
// attachments live in NoteMetadata, whose JS constructor is attachment-less by
// design, the generic `new Note(assets, metadata, recipient)` takes no
// attachment, and the only attachment-accepting builders (createP2ID[E]Note)
// hardwire the P2ID script. So the bridge NTX's active_account_matches_target
// assert could never be satisfied. Fix belongs in the SDK, not here.
// The real call is kept in a comment so it drops in verbatim once the SDK ships.

export const MIDEN_BRIDGE_ID = "0xc98bb07c188cd2500e13f68a069cdc";
export const MIDEN_AGGLAYER_FAUCET_ID = "0xe63ba7bc2c19ff603c52c67fa4426d";

// Agglayer network id of the EVM destination (Sepolia / L1 origin network) used
// as the destination network when bridging Miden → EVM.
export const EVM_AGGLAYER_NETWORK_ID = 0;

export class B2AggNoteUnavailableError extends Error {
  constructor() {
    super(
      "AggLayer Miden→Sepolia send needs Note.createB2AggNote, which is not in " +
        "the published @miden-sdk. Waiting on the SDK build that exposes it.",
    );
    this.name = "B2AggNoteUnavailableError";
  }
}

/**
 * Build the B2AGG transaction request that bridges `amount` of the AggLayer
 * faucet asset from `senderAddress` (Miden bech32) out to `destinationAddress`
 * (Sepolia, 20-byte EVM address) via the Miden bridge account.
 *
 * Blocked on the SDK: throws until `Note.createB2AggNote` is published. The
 * exact call (from the wallet branch) is:
 *
 *   const note = Note.createB2AggNote(
 *     EVM_AGGLAYER_NETWORK_ID,          // destinationNetwork
 *     destinationAddress,               // 20-byte EVM address
 *     new NoteAssets([
 *       new FungibleAsset(AccountId.fromHex(MIDEN_AGGLAYER_FAUCET_ID), amount),
 *     ]),
 *     AccountId.fromHex(MIDEN_BRIDGE_ID),
 *     accountIdStringToSdk(senderAddress),
 *   );
 *   return new TransactionRequestBuilder()
 *     .withOwnOutputNotes(new NoteArray([note]))
 *     .build();
 */
export function buildB2AggTransactionRequest(args: {
  amount: bigint;
  destinationAddress: string;
  senderAddress: string;
}): never {
  void args; // signature is the real one; body lands when the SDK ships.
  throw new B2AggNoteUnavailableError();
}
