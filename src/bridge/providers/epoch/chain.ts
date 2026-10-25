import type { BridgeConfig } from "../../../config/bridge-config";
import { Endpoint, NoteId, RpcClient } from "@miden-sdk/miden-sdk";

import { configMidenNetwork } from "../../../config/bridge-config";

/** Read the chain head when minting a note with the SDK's reclaim window. */
export async function getCurrentMidenBlock(recovery?: BridgeConfig): Promise<number> {
  const header = await new RpcClient(new Endpoint(configMidenNetwork(recovery).rpcUrl))
    .getBlockHeaderByNumber(undefined);
  return Number(header.blockNum());
}

/** Recover collateral confirmation without a wallet session or a second transfer. */
export async function getMidenNoteBlock(noteId: string, recovery: BridgeConfig): Promise<number | undefined> {
  const rpc = new RpcClient(new Endpoint(configMidenNetwork(recovery).rpcUrl));
  const resources: { free(): void }[] = [rpc];
  try {
    // The RPC consumes the note ID array; fetched notes and their getters are owned here.
    const notes = await rpc.getNotesById([NoteId.fromHex(noteId)]);
    resources.push(...notes);
    for (const note of notes) {
      const fetchedId = note.noteId;
      resources.push(fetchedId);
      if (fetchedId.toString() !== noteId) continue;
      const proof = note.inclusionProof;
      resources.push(proof);
      const location = proof.location();
      resources.push(location);
      return location.blockNum();
    }
  } finally {
    resources.reverse().forEach(resource => resource.free());
  }
}
