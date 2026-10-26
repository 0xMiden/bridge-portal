import type { BridgeConfig } from "../../../config/bridge-config";
import type { MidenFiWalletContextState } from "@miden-sdk/miden-wallet-adapter-react";
import { agglayerConfig } from "./agglayer";
import { createFeeConversionSalt } from "../../../wallets/miden/miden-transaction";

// Agglayer outbound (Miden → Sepolia / L2→L1). Builds the B2AGG bridge-out note
// with `Note.createB2AggNote` and submits it through the MidenFi wallet's
// `requestTransaction`.
//
// On 0.17 the asset callback flag is intrinsic to the faucet account id. The
// Cardona ETH faucet id already encodes Enabled-callback assets, so constructing
// `new FungibleAsset(faucet, amount)` is enough. Do not call withCallbacks.
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
  /** Persist the accepted request before waiting for on-chain confirmation. */
  onSubmitted: (source: { requestId: string; noteId: string }) => void;
}

export interface AgglayerSendResult {
  /** Wallet-adapter request id (a UUID) — internal tracking, NOT an on-chain id. */
  txId: string;
  /** The real on-chain Miden tx hash (0x + 64 hex), for the Midenscan link. */
  txHash: string;
}

type SendInput = {
  /** Bridge-out amount in the faucet's base units. */
  amount: bigint;
  faucetId: string;
  destinationAddress: string;
  senderAddress: string;
};

async function buildWithdrawal({ amount, faucetId, destinationAddress, senderAddress }: SendInput, recovery?: BridgeConfig) {
  const config = agglayerConfig(recovery);
  const {
    EthAddress,
    FungibleAsset,
    Note,
    NoteArray,
    NoteAssets,
    TransactionRequestBuilder,
  } = await import("@miden-sdk/miden-sdk");
  const { parseMidenAccountId } = await import("../../miden-address-sdk");
  const { Transaction } = await import("@miden-sdk/miden-wallet-adapter-base");

  const sender = parseMidenAccountId(senderAddress);
  const bridge = parseMidenAccountId(config.midenBridgeId);
  const faucet = parseMidenAccountId(faucetId);

  // 0.17: the callback flag is intrinsic to the faucet account id. Do not call
  // withCallbacks (removed). The Cardona ETH faucet id already encodes Enabled.
  const asset = new FungibleAsset(faucet, amount);

  const note = Note.createB2AggNote(
    sender,
    bridge,
    new NoteAssets([asset]),
    config.sourceNetworkId,
    EthAddress.fromHex(destinationAddress),
  );
  const noteId = note.id().toString();

  const request = new TransactionRequestBuilder()
    .withFeeConversionSalt(createFeeConversionSalt())
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

  return { transaction, noteId };
}

export async function runAgglayerSend(
  input: SendInput & AgglayerSendDeps, recovery?: BridgeConfig,
): Promise<AgglayerSendResult> {
  const { transaction, noteId } = await buildWithdrawal(input, recovery);
  const txId = await input.requestTransaction(transaction);
  input.onSubmitted({ requestId: txId, noteId });
  // The wallet request UUID is not an on-chain identifier.
  const output = await input.waitForTransaction(txId);
  return { txId, txHash: output.txHash };
}
