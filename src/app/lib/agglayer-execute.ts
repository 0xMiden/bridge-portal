import type { MidenFiWalletContextState } from "@miden-sdk/miden-wallet-adapter-react";
import { normalizeMidenAccountHex } from "./agglayer";
import { EVM_AGGLAYER_NETWORK_ID, MIDEN_BRIDGE_ID } from "./agglayer-b2agg";

// Agglayer outbound (Miden → Sepolia / L2→L1). Builds the B2AGG bridge-out note
// with `Note.createB2AggNote` and submits it through the MidenFi wallet's
// `requestTransaction`.
//
// The Agglayer ETH faucet has transfer policies, so the asset it mints is stored
// in the vault with `AssetCallbackFlag.Enabled`. The bridge-out note's asset must
// carry the SAME flag or its commitment won't match the vault entry, and removal
// fails with "amount of the asset in the vault is less than the amount to remove"
// (for any amount). `new FungibleAsset(faucet, amount)` defaults to `Disabled`;
// `.withCallbacks(Enabled)` is the fix (web-sdk#239 / PR#240 — the API this build
// of @miden-sdk vendors ahead of a >0.15.6 npm release).
//
// Loaded via dynamic import at click time — it pulls the eager-WASM SDK + the
// wallet adapter, so it must never enter the SSR/server bundle.

export interface AgglayerSendDeps {
  requestTransaction: NonNullable<
    MidenFiWalletContextState["requestTransaction"]
  >;
  waitForTransaction: NonNullable<
    MidenFiWalletContextState["waitForTransaction"]
  >;
}

export interface AgglayerSendResult {
  /** Wallet-adapter request id (a UUID) — internal tracking, NOT an on-chain id. */
  txId: string;
  /** The real on-chain Miden tx hash (0x + 64 hex), for the Midenscan link. */
  txHash: string;
}

export async function runAgglayerSend({
  amount,
  faucetId,
  destinationAddress,
  senderAddress,
  requestTransaction,
  waitForTransaction,
}: {
  /** Bridge-out amount in the Agglayer ETH faucet's base units. */
  amount: bigint;
  /**
   * The Agglayer ETH faucet the sender holds (the canonical bali faucet,
   * `AGGLAYER_BALI.midenEthFaucetIdHex`).
   */
  faucetId: string;
  /** Sepolia recipient, 0x-prefixed 20-byte EVM address. */
  destinationAddress: string;
  /** Sender Miden account — bech32 (mcst1…/mtst1…) or hex. */
  senderAddress: string;
} & AgglayerSendDeps): Promise<AgglayerSendResult> {
  const {
    AccountId,
    AssetCallbackFlag,
    EthAddress,
    FungibleAsset,
    Note,
    NoteArray,
    NoteAssets,
    TransactionRequestBuilder,
  } = await import("@miden-sdk/miden-sdk");
  const { Transaction } = await import("@miden-sdk/miden-wallet-adapter-base");

  const sender = AccountId.fromHex(`0x${normalizeMidenAccountHex(senderAddress)}`);
  const bridge = AccountId.fromHex(MIDEN_BRIDGE_ID);
  const faucet = faucetId.startsWith("0x")
    ? AccountId.fromHex(faucetId)
    : AccountId.fromBech32(faucetId);

  // Match the vault's callback-enabled asset (see the file header) so the note's
  // asset removal succeeds.
  const asset = new FungibleAsset(faucet, amount).withCallbacks(
    AssetCallbackFlag.Enabled,
  );

  const note = Note.createB2AggNote(
    sender,
    bridge,
    new NoteAssets([asset]),
    EVM_AGGLAYER_NETWORK_ID,
    EthAddress.fromHex(destinationAddress),
  );

  const request = new TransactionRequestBuilder()
    .withOwnOutputNotes(new NoteArray([note]))
    .build();

  // createCustomTransaction(address, recipientAddress, transactionRequest, …).
  // Both address fields carry the sender's Miden account (recipientAddress is
  // wallet display/tracking metadata, not the EVM destination).
  const transaction = Transaction.createCustomTransaction(
    senderAddress,
    senderAddress,
    request,
  );

  const txId = await requestTransaction(transaction);
  // requestTransaction returns the wallet's request id (a UUID); the real
  // on-chain tx hash only comes back on the settled TransactionOutput. Use that
  // for the Midenscan link — the UUID produces a broken /tx/ URL.
  const output = await waitForTransaction(txId);
  return { txId, txHash: output.txHash };
}
