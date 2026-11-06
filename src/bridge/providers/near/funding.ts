import { Address, Note, NoteAssets, NoteArray, NoteAttachment, NoteType, FungibleAsset, TransactionRequestBuilder } from "@miden-sdk/miden-sdk";
import { Transaction } from "@miden-sdk/miden-wallet-adapter-base";
import type { BridgeConfig } from "../../../config/bridge-config";
import { createFeeConversionSalt } from "../../../wallets/miden/miden-transaction";
import { parseMidenAccountId } from "../../miden-address-sdk";
import { nearPair, verifyNearQuote } from "./quote";
import { validateNearDeposit } from "./execute";
import type { NearInput, NearQuoteResponse } from "./schema";

/** Standard public P2ID: the SDK derives the recipient's discovery tag. No Epoch collateral contract. */
export function buildNearDeposit(response: NearQuoteResponse, input: NearInput, recovery: BridgeConfig) {
  const quote = verifyNearQuote(response, input, false);
  const address = validateNearDeposit(quote);
  if (recovery.environment !== "mainnet" || recovery.near?.funding.script !== "p2id") throw new Error("Unsupported NEAR funding configuration.");
  const sender = parseMidenAccountId(input.midenAccount);
  const recipient = parseMidenAccountId(address);
  const faucet = parseMidenAccountId(nearPair(input.routeId).source.faucetId);
  const note = Note.createP2IDNote(sender, recipient,
    new NoteAssets([new FungibleAsset(faucet, BigInt(quote.quote.amountIn))]), NoteType.Public, new NoteAttachment());
  const depositAddress = Address.fromBech32(address);
  try {
    if (depositAddress.toNoteTag().asU32() !== note.metadata().tag().asU32()) throw new Error("Unsupported Miden deposit discovery tag.");
  } finally { depositAddress.free(); }
  const noteId = note.id().toString();
  const request = new TransactionRequestBuilder().withFeeConversionSalt(createFeeConversionSalt())
    .withOwnOutputNotes(new NoteArray([note])).build();
  return { noteId, transaction: Transaction.createCustomTransaction(input.midenAccount, address, request) };
}
