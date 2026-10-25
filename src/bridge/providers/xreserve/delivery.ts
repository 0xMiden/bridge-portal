import type { BridgeConfig } from "../../../config/bridge-config";
import type * as MidenSdk from "@miden-sdk/miden-sdk";
import type { ArcDepositIntent } from "./attestation";

/** XUsdcMintNoteStorage on protocol v0.17.1: nonce -> P2ID serial number. */
export function deriveArcNoteId(
  intent: ArcDepositIntent,
  sdk: typeof MidenSdk,
): string {
  const resources: { free(): void }[] = [];
  const keep = <T extends { free(): void }>(value: T): T => {
    resources.push(value);
    return value;
  };
  try {
    const bytes = Uint8Array.from(intent.nonce.slice(2).match(/../g)!, (byte) =>
      parseInt(byte, 16),
    );
    const view = new DataView(bytes.buffer);
    const limbs = new sdk.FeltArray(); // hashElements takes ownership.
    for (let i = 0; i < 8; i++)
      limbs.push(keep(new sdk.Felt(BigInt(view.getUint32(i * 4, true)))));
    const serial = keep(sdk.Poseidon2.hashElements(limbs));
    const faucet = keep(sdk.AccountId.fromHex(intent.faucet));
    const target = keep(sdk.AccountId.fromHex(intent.recipient));
    const asset = keep(new sdk.FungibleAsset(faucet, BigInt(intent.amount)));
    const assets = keep(new sdk.NoteAssets());
    assets.push(asset);
    // The SDK supplies the version-matched P2ID script and target storage.
    const template = keep(
      sdk.Note.createP2IDNote(
        faucet,
        target,
        assets,
        sdk.NoteType.Public,
        keep(new sdk.NoteAttachment()),
      ),
    );
    const templateRecipient = keep(template.recipient());
    const recipient = keep(
      new sdk.NoteRecipient(
        serial,
        keep(template.script()),
        keep(templateRecipient.storage()),
      ),
    );
    const tag = keep(sdk.NoteTag.withAccountTarget(target));
    const metadata = keep(
      new sdk.NoteMetadata(faucet, sdk.NoteType.Public, tag),
    );
    const note = keep(new sdk.Note(assets, metadata, recipient));
    return keep(note.id()).toString();
  } finally {
    resources.reverse().forEach((value) => value.free());
  }
}

/** Exact note lookup: an attestation or an unrelated balance change is never delivery. */
export async function checkArcDelivery(
  intent: ArcDepositIntent,
  recovery?: BridgeConfig,
): Promise<{ noteId: string; block?: number }> {
  const sdk = await import("@miden-sdk/miden-sdk");
  const { getMidenNoteBlock } = await import("../../miden-rpc");
  const noteId = deriveArcNoteId(intent, sdk);
  const block = await getMidenNoteBlock(noteId, recovery);
  return { noteId, block };
}
