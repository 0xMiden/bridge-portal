use miden_protocol::account::AccountId;
use miden_protocol::asset::FungibleAsset;
use miden_protocol::note::{Note, NoteAssets, NoteTag, NoteType, PartialNoteMetadata};
use miden_protocol::{Felt, Hasher};
use miden_standards::note::P2idNoteStorage;
fn main() {
    let faucet = AccountId::from_hex("0x4cbdcaffe75f0a317482224dae6436").unwrap();
    let target = AccountId::from_hex("0x4e6fb40fd2f6a55140df2c42dfb5b7").unwrap();
    let nonce = "abab9dfff95292a7b7ff97b193c2f17ac361ca98e3b9f15fed8d508795fc4220";
    let bytes: Vec<u8> = (0..64)
        .step_by(2)
        .map(|i| u8::from_str_radix(&nonce[i..i + 2], 16).unwrap())
        .collect();
    let felts: Vec<Felt> = bytes
        .chunks_exact(4)
        .map(|b| Felt::from(u32::from_le_bytes(b.try_into().unwrap())))
        .collect();
    let serial = Hasher::hash_elements(&felts);
    let recipient = P2idNoteStorage::new(target).into_recipient(serial);
    let assets =
        NoteAssets::new(vec![FungibleAsset::new(faucet, 1000000).unwrap().into()]).unwrap();
    let metadata = PartialNoteMetadata::new(faucet, NoteType::Public)
        .with_tag(NoteTag::with_account_target(target));
    let note = Note::new(assets, metadata, recipient);
    println!(
        "serial={}\nnote_id={}\nscript={}",
        serial,
        note.id(),
        note.script().root()
    );
}
