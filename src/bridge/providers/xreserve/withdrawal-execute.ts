import type { MidenFiWalletContextState } from "@miden-sdk/miden-wallet-adapter-react";
import type { BridgeNetwork } from "../../core/assets";
import { normalizeMidenAccountHex } from "../agglayer/agglayer";
import { ARC } from "./config";
import { validateWithdrawal, withdrawalDomains, withdrawalPayload } from "./withdrawal";
import { createFeeConversionSalt } from "../../../wallets/miden/miden-transaction";

/** Matches 0xMiden/wallet's v0.17.1 XReserveBurnNote construction. Browser only. */
export async function withdrawUsdcx(input: {
  amount: string;
  network: BridgeNetwork;
  destination: string;
  sender: string;
  requestTransaction: NonNullable<MidenFiWalletContextState["requestTransaction"]>;
  waitForTransaction: NonNullable<MidenFiWalletContextState["waitForTransaction"]>;
  onSubmitted: (noteId: string, requestId: string) => void;
}): Promise<{ noteId: string; txHash: string }> {
  const amount = validateWithdrawal(input.amount, input.network);
  const payload = withdrawalPayload(input.destination, withdrawalDomains[input.network]!);
  const sdk = await import("@miden-sdk/miden-sdk");
  const { Transaction } = await import("@miden-sdk/miden-wallet-adapter-base");
  const faucet = sdk.AccountId.fromHex(ARC.faucetId);
  const rpc = new sdk.RpcClient(new sdk.Endpoint(process.env.NEXT_PUBLIC_MIDEN_RPC_URL ?? "https://rpc.testnet.miden.io"));
  try {
    const fetched = await rpc.getAccountDetails(faucet);
    const account = fetched.account();
    // Account.storage() is patched to StorageView at runtime; RPC types still
    // describe the raw WASM return. Only the underlying objects own free().
    const view = account?.storage() as unknown as import("@miden-sdk/miden-sdk").StorageView | undefined;
    const storage = view?.raw;
    const minimum = storage?.getItem("miden::standards::faucets::policies::burn::min_burn_amount::min_burn_amount");
    const allowed = storage?.getMapItem("miden::standards::auth::network_account::allowed_note_scripts", sdk.NoteScript.burn().root());
    try {
      if (allowed?.toU64s()[0] !== 1n) throw new Error("The USDCx faucet does not currently accept this burn script.");
      const floor = minimum?.toU64s()[0];
      if (floor === undefined) throw new Error("Unable to verify the faucet's minimum withdrawal. Try again later.");
      if (amount < floor) throw new Error(`The faucet requires at least ${Number(floor) / 1e6} USDCx per withdrawal.`);
    } finally { minimum?.free(); allowed?.free(); storage?.free(); account?.free(); fetched.free(); }
  } finally { rpc.free(); }
  const asset = new sdk.FungibleAsset(faucet, amount);
  const storage = new sdk.NoteStorage(new sdk.FeltArray([...asset.vaultKey().toFelts(), ...asset.intoWord().toFelts()]));
  const recipient = sdk.NoteRecipient.fromScript(sdk.NoteScript.burn(), storage);
  const sender = sdk.AccountId.fromHex(`0x${normalizeMidenAccountHex(input.sender)}`);
  const metadata = new sdk.NoteMetadata(sender, sdk.NoteType.Public, new sdk.NoteTag(0x4255524e));
  const words = [0, 4, 8].map(i => new sdk.Word(new BigUint64Array(payload.slice(i, i + 4))));
  const withdrawal = sdk.NoteAttachment.fromWords(new sdk.NoteAttachmentScheme(5), words);
  const routing = new sdk.NetworkAccountTarget(faucet, sdk.NoteExecutionHint.always()).toAttachment();
  const note = sdk.Note.withAttachments(new sdk.NoteAssets([asset]), metadata, recipient, [routing, withdrawal]);
  const noteId = note.id().toString();
  const request = new sdk.TransactionRequestBuilder()
    .withFeeConversionSalt(createFeeConversionSalt())
    .withOwnOutputNotes(new sdk.NoteArray([note])).build();
  const transaction = Transaction.createCustomTransaction(input.sender, input.sender, request);
  const requestId = await input.requestTransaction(transaction);
  input.onSubmitted(noteId, requestId);
  const output = await input.waitForTransaction(requestId);
  return { noteId, txHash: output.txHash };
}
