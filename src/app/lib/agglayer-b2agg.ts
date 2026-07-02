// Outbound Miden→Sepolia (B2AGG) constants and note builder.
//
// The whole B2AGG note — B2AGG script, NetworkAccountTarget attachment, input
// felts, fungible asset — is built by a SINGLE SDK factory that #[js_export]s
// the protocol's native `B2AggNote::create`. It can't be hand-rolled on the
// published SDK: a B2AGG note is {custom script + NetworkAccountTarget
// attachment}, but the 0.15 JS surface has no way to attach an attachment to a
// custom-script note (NoteMetadata's ctor is attachment-less, generic
// `new Note()` takes no attachment, and createP2ID[E]Note hardwire the P2ID
// script). So it must come from the SDK — and it now HAS:
//
//   0xMiden/web-sdk#211 (merged 2026-06-29, closes #173) adds it, staged for
//   release @miden-sdk 0.15.4 (NOT yet published — latest npm is 0.15.3, which
//   is why the send still throws here). No fork needed; just bump to 0.15.4.
//
// When 0.15.4 lands, prefer the HIGH-LEVEL API over hand-assembling a note:
//   - react:  useBridge() → bridge({ from, bridgeAccount, assetId, amount,
//               destinationNetwork, destinationAddress })
//   - client: client.transactions.bridge({ account, bridgeAccount, token,
//               amount, destinationNetwork, destinationAddress })
// Low-level (if needed): Note.createB2AggNote(sender, bridgeAccount, assets,
//   destinationNetwork, destinationAddress) — destinationAddress is the new
//   EthAddress class (EthAddress.fromHex("0x…")) — then
//   client.newB2AggTransactionRequest(...) / TransactionRequestBuilder.
// NOTE: this final arg order differs from the wallet branch's pre-merge draft.

// Post-2026-06-24 rollup-78 relaunch (gateway.fm PARAMETERS.md).
// bech32: bridge mcst1az3zas25lx3kmyge2074eynq5um0mm2h, faucet mcst1aqu8zjdwvcgkeug5a67kpwmnsym6qdsd
export const MIDEN_BRIDGE_ID = "0xa22ec154f9a36d911953fd5c9260a7";
export const MIDEN_AGGLAYER_FAUCET_ID = "0x387149ae66116cf114eebd60bb7381";

// Agglayer network id of the EVM destination (Sepolia / L1 origin network) used
// as the destination network when bridging Miden → EVM.
export const EVM_AGGLAYER_NETWORK_ID = 0;

export class B2AggNoteUnavailableError extends Error {
  constructor() {
    super(
      "AggLayer Miden→Sepolia send needs the B2AGG bridge API (web-sdk#211), " +
        "shipping in @miden-sdk 0.15.4 — not yet published (latest is 0.15.3).",
    );
    this.name = "B2AggNoteUnavailableError";
  }
}

/**
 * Build the B2AGG transaction request that bridges `amount` of the AggLayer
 * faucet asset from `senderAddress` (Miden bech32) out to `destinationAddress`
 * (Sepolia, 20-byte EVM address) via the Miden bridge account.
 *
 * Blocked until @miden-sdk 0.15.4 ships the B2AGG API (web-sdk#211). Prefer the
 * high-level path then — no manual note assembly:
 *
 *   // react:  const { bridge } = useBridge();
 *   await bridge({
 *     from: senderAddress,
 *     bridgeAccount: MIDEN_BRIDGE_ID,
 *     assetId: MIDEN_AGGLAYER_FAUCET_ID,
 *     amount,
 *     destinationNetwork: EVM_AGGLAYER_NETWORK_ID,
 *     destinationAddress: EthAddress.fromHex(destinationAddress),
 *   });
 *
 * Low-level equivalent (final signature — note the arg order):
 *   Note.createB2AggNote(sender, bridgeAccount, assets, destinationNetwork,
 *     EthAddress.fromHex(destinationAddress)) → newB2AggTransactionRequest(...).
 */
export function buildB2AggTransactionRequest(args: {
  amount: bigint;
  destinationAddress: string;
  senderAddress: string;
}): never {
  void args; // signature is the real one; body lands when the SDK ships.
  throw new B2AggNoteUnavailableError();
}
