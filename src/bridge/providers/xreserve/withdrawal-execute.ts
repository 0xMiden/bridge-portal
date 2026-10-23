import type { BridgeConfig } from "../../../config/bridge-config";
import type { MidenFiWalletContextState } from "@miden-sdk/miden-wallet-adapter-react";
import type { BridgeNetwork } from "../../core/assets";
import { normalizeMidenAccountHex } from "../agglayer/agglayer";
import { arcConfig } from "./config";
import { validateWithdrawal, withdrawalDomains, withdrawalPayload } from "./withdrawal";
import { configMidenNetwork } from "../../../config/bridge-config";
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
}, recovery?: BridgeConfig): Promise<{ noteId: string; txHash: string }> {
  const ARC = arcConfig(recovery);
  const amount = validateWithdrawal(input.amount, input.network);
  const payload = withdrawalPayload(input.destination, withdrawalDomains[input.network]!);
  const sdk = await import("@miden-sdk/miden-sdk");
  const { Transaction } = await import("@miden-sdk/miden-wallet-adapter-base");
  const faucet = sdk.AccountId.fromHex(ARC.faucetId);
  const rpc = new sdk.RpcClient(new sdk.Endpoint(configMidenNetwork(recovery).rpcUrl));
  try {
    // Only request the burn-policy entry. Fetching the full faucet account fails
    // once its unrelated used_nonces map exceeds the node's response limit.
    const slot = "miden::standards::auth::network_account::allowed_note_scripts";
    const script = sdk.NoteScript.burn();
    const root = script.root();
    const rootHex = root.toHex();
    script.free();
    const requirements = sdk.AccountStorageRequirements.fromSlotAndKeysArray([
      new sdk.SlotAndKeys(slot, [root]),
    ]);
    // The SDK consumes requirements (and its keys) when constructing the request.
    const proof = await rpc.getAccountProof(faucet, requirements);
    try {
      const minimum = proof.getStorageSlotValue("miden::standards::faucets::policies::burn::min_burn_amount::min_burn_amount");
      const entries = proof.getStorageMapEntries(slot) ?? [];
      let allowed = false;
      try {
        for (const entry of entries) {
          const key = entry.key();
          const value = entry.value();
          try {
            if (key.toHex() === rootHex && value.toU64s()[0] === 1n) allowed = true;
          } finally { key.free(); value.free(); }
        }
        if (!allowed) throw new Error("The USDCx faucet does not currently accept this burn script.");
        const floor = minimum?.toU64s()[0];
        if (floor === undefined) throw new Error("Unable to verify the faucet's minimum withdrawal. Try again later.");
        if (amount < floor) throw new Error(`The faucet requires at least ${Number(floor) / 1e6} USDCx per withdrawal.`);
      } finally { minimum?.free(); entries.forEach(entry => entry.free()); }
    } finally { proof.free(); }
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
