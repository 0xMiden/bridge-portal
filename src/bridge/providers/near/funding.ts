import { Address, Note, NoteAssets, NoteArray, NoteAttachment, NoteType, FungibleAsset, TransactionRequestBuilder } from "@miden-sdk/miden-sdk";
import { Transaction } from "@miden-sdk/miden-wallet-adapter-base";
import type { BridgeConfig } from "../../../config/bridge-config";
import { createFeeConversionSalt } from "../../../wallets/miden/miden-transaction";
import { parseMidenAccountId } from "../../miden-address-sdk";
import { nearPair, validateNearDeposit, verifyNearQuote } from "./quote";
import type { NearInput, NearQuoteResponse } from "./schema";

/** The quoted deposit account can consume immediately. The sender can reclaim an unspent note at the configured height. */
export function buildNearDeposit(response: NearQuoteResponse, input: NearInput, recovery: BridgeConfig, blockNumber: number) {
  const quote = verifyNearQuote(response, input, false);
  const address = validateNearDeposit(quote);
  const funding = recovery.near?.funding;
  if (input.mode !== "send" || recovery.environment !== "mainnet" || funding?.script !== "p2ide") {
    throw new Error("Unsupported NEAR funding configuration.");
  }
  const reclaimHeight = blockNumber + funding.reclaimBlocks;
  if (!Number.isSafeInteger(blockNumber) || blockNumber < 0 || reclaimHeight > 0xffff_ffff) {
    throw new Error("Invalid Miden block height for NEAR deposit recovery.");
  }
  const sender = parseMidenAccountId(input.midenAccount);
  const recipient = parseMidenAccountId(address);
  const faucet = parseMidenAccountId(nearPair(input.routeId).source.faucetId);
  const note = Note.createP2IDENote(
    sender, recipient, new NoteAssets([new FungibleAsset(faucet, BigInt(quote.quote.amountIn))]),
    reclaimHeight, null, NoteType.Public, new NoteAttachment(),
  );
  const depositAddress = Address.fromBech32(address);
  try {
    if (depositAddress.toNoteTag().asU32() !== note.metadata().tag().asU32()) throw new Error("Unsupported Miden deposit discovery tag.");
  } finally { depositAddress.free(); }
  const noteId = note.id().toString();
  const request = new TransactionRequestBuilder().withFeeConversionSalt(createFeeConversionSalt())
    .withOwnOutputNotes(new NoteArray([note])).build();
  return { noteId, transaction: Transaction.createCustomTransaction(input.midenAccount, address, request) };
}
