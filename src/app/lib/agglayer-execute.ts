import type { MidenFiWalletContextState } from "@miden-sdk/miden-wallet-adapter-react";
import { normalizeMidenAccountHex } from "./agglayer";
import {
  EVM_AGGLAYER_NETWORK_ID,
  MIDEN_AGGLAYER_FAUCET_ID,
  MIDEN_BRIDGE_ID,
} from "./agglayer-b2agg";

// AggLayer outbound (Miden → Sepolia / L2→L1). Builds the B2AGG bridge-out note
// with the SDK's `Note.createB2AggNote` (shipped in @miden-sdk 0.15.4 / web-sdk
// #211) and submits it through the MidenFi wallet's `requestTransaction`, which
// accepts a pre-built custom TransactionRequest (unlike `requestSend`, which
// only builds P2ID sends internally).
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
  txId: string;
}

export async function runAgglayerSend({
  amount,
  destinationAddress,
  senderAddress,
  requestTransaction,
  waitForTransaction,
}: {
  /** Bridge-out amount in Miden base units (ETH faucet is 8 decimals). */
  amount: bigint;
  /** Sepolia recipient, 0x-prefixed 20-byte EVM address. */
  destinationAddress: string;
  /** Sender Miden account — bech32 (mcst1…) or hex. */
  senderAddress: string;
} & AgglayerSendDeps): Promise<AgglayerSendResult> {
  const {
    AccountId,
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
  const faucet = AccountId.fromHex(MIDEN_AGGLAYER_FAUCET_ID);

  // Note.createB2AggNote(sender, bridgeAccount, assets, destinationNetwork, destinationAddress)
  const note = Note.createB2AggNote(
    sender,
    bridge,
    new NoteAssets([new FungibleAsset(faucet, amount)]),
    EVM_AGGLAYER_NETWORK_ID,
    EthAddress.fromHex(destinationAddress),
  );

  const request = new TransactionRequestBuilder()
    .withOwnOutputNotes(new NoteArray([note]))
    .build();

  // createCustomTransaction(address, recipientAddress, transactionRequest, …).
  // The note is an own-output consumed by the bridge account, so both address
  // fields carry the sender's Miden account (recipientAddress here is wallet
  // display/tracking metadata, not the EVM destination).
  const transaction = Transaction.createCustomTransaction(
    senderAddress,
    senderAddress,
    request,
  );

  const txId = await requestTransaction(transaction);
  await waitForTransaction(txId);
  return { txId };
}
