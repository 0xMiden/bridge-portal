"use client";
import type { BridgeConfig } from "../../../config/bridge-config";

import type { SolveIntentParams } from "@epoch-protocol/epoch-intents-sdk";
import {
  AccountInterface,
  FungibleAsset,
  NetworkId,
  Note,
  NoteAssets,
  NoteAttachment,
  NoteType,
  TransactionRequestBuilder,
} from "@miden-sdk/miden-sdk";
import { Transaction } from "@miden-sdk/miden-wallet-adapter-base";
import type { MidenFiWalletContextState } from "@miden-sdk/miden-wallet-adapter-react";

import { parseMidenAccountId } from "../../miden-address-sdk";
import { getCurrentMidenBlock } from "../../miden-rpc";
import { createFeeConversionSalt } from "../../../wallets/miden/miden-transaction";

export type CreateMidenP2IDENote = NonNullable<SolveIntentParams["createMidenP2IDENote"]>;

/** Wallet methods required to submit an Epoch collateral note. */
export interface MidenNoteDeps {
  requestTransaction: NonNullable<MidenFiWalletContextState["requestTransaction"]>;
  waitForTransaction: NonNullable<MidenFiWalletContextState["waitForTransaction"]>;
  /** Connected sender's Miden account — bech32 (`mm1…` / `mtst1…`) or 0x hex. */
  senderAddress: string;
  /** Surface wallet acceptance immediately, before the confirmation wait. */
  onNoteSubmitted?: (info: { requestId: string; noteId: string }) => void;
  /** Surface the committed note details for activity tracking. */
  onNoteCreated?: (info: { noteId: string; txHash: string }) => void;
}

/**
 * Epoch 1.0.39 supplies the reclaim window and mandate-binding attachment.
 * Build a custom transaction: requestSend cannot carry a note attachment.
 * The current block is read at note creation, after the quote has resolved.
 */
export function createBridgeP2IDENoteCallback(deps: MidenNoteDeps, recovery?: BridgeConfig): CreateMidenP2IDENote {
  return async (faucetId, amount, allocatorId, recallBlocks, bindingAttachmentFelts) => {
    try {
      const amountBaseUnits = BigInt(amount);
      if (amountBaseUnits <= 0n || amountBaseUnits > (1n << 64n) - 1n) {
        throw new Error(`Invalid Miden bridge amount: "${amount}".`);
      }
      if (!Number.isSafeInteger(recallBlocks) || recallBlocks <= 0) {
        throw new Error("Invalid Epoch reclaim window.");
      }
      if (!bindingAttachmentFelts?.length || bindingAttachmentFelts.some(
        (felt) => felt < 0n || felt >= 18_446_744_069_414_584_321n,
      )) {
        throw new Error("Epoch mandate-binding attachment is missing or invalid.");
      }
      const currentBlock = await getCurrentMidenBlock(recovery);
      const reclaimHeight = currentBlock + recallBlocks;
      if (!Number.isSafeInteger(currentBlock) || currentBlock < 0 || reclaimHeight > 0xffff_ffff) {
        throw new Error("Invalid Epoch reclaim height.");
      }

      const sender = parseMidenAccountId(deps.senderAddress);
      const allocator = parseMidenAccountId(allocatorId);
      const faucet = parseMidenAccountId(faucetId);
      const note = Note.createP2IDENote(
        sender,
        allocator,
        new NoteAssets([new FungibleAsset(faucet, amountBaseUnits)]),
        reclaimHeight,
        null,
        NoteType.Public,
        new NoteAttachment(BigUint64Array.from(bindingAttachmentFelts)),
      );
      const expectedNoteId = note.id().toString();
      const { NoteArray } = await import("@miden-sdk/miden-sdk");
      const request = new TransactionRequestBuilder()
        .withFeeConversionSalt(createFeeConversionSalt())
        .withOwnOutputNotes(new NoteArray([note]))
        .build();
      const network = recovery?.environment === "mainnet" ? NetworkId.mainnet() : NetworkId.testnet();
      const transaction = Transaction.createCustomTransaction(
        deps.senderAddress,
        allocator.toBech32(network, AccountInterface.BasicWallet),
        request,
      );

      const txId = await deps.requestTransaction(transaction);
      deps.onNoteSubmitted?.({ requestId: txId, noteId: expectedNoteId });
      const output = await deps.waitForTransaction(txId);
      // Fee-paying transactions also emit a fee note. Return our collateral
      // note even when it is not the first output.
      const noteId = output.outputNotes?.find(
        (outputNote) => outputNote.id().toString() === expectedNoteId,
      )?.id().toString();
      if (!noteId) {
        console.error("[epoch] bridge note committed but no output note id", { txId });
        return { success: false };
      }

      deps.onNoteCreated?.({ noteId, txHash: output.txHash });
      return { success: true, noteId };
    } catch (err) {
      console.error("[epoch] createBridgeP2IDENote failed", err);
      return { success: false };
    }
  };
}
