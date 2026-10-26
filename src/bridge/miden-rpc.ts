import { configMidenNetwork, type BridgeConfig } from "../config/bridge-config";
import { midenNetworks } from "../config/environment";
import type { MidenNetwork } from "./core/assets";

/** The live verification rate is in the native fee asset's smallest units. */
export async function getMidenVerificationBaseFee(recovery: BridgeConfig): Promise<number> {
  const { Endpoint, RpcClient } = await import("@miden-sdk/miden-sdk");
  const rpc = new RpcClient(new Endpoint(configMidenNetwork(recovery).rpcUrl));
  const resources: { free(): void }[] = [rpc];
  try {
    const header = await rpc.getBlockHeaderByNumber();
    resources.push(header);
    const fee = header.verificationBaseFee();
    if (!Number.isInteger(fee) || fee < 0 || fee > 0xffffffff) {
      throw new Error("Miden network fee is unavailable.");
    }
    return fee;
  } finally { resources.reverse().forEach(resource => resource.free()); }
}

/** Read the chain head on the transfer's Miden network. */
export async function getCurrentMidenBlock(recovery?: BridgeConfig): Promise<number> {
  const { Endpoint, RpcClient } = await import("@miden-sdk/miden-sdk");
  const rpc = new RpcClient(new Endpoint(configMidenNetwork(recovery).rpcUrl));
  try {
    const header = await rpc.getBlockHeaderByNumber();
    try { return header.blockNum(); }
    finally { header.free(); }
  } finally { rpc.free(); }
}

/** Read public fungible faucet metadata on the token's network. */
export async function getMidenFaucetMetadata(faucetId: string, network: MidenNetwork): Promise<{
  decimals: number;
  symbol: string;
} | undefined> {
  const { BasicFungibleFaucetComponent, Endpoint, RpcClient } = await import("@miden-sdk/miden-sdk");
  const { parseMidenAccountId } = await import("./miden-address-sdk");
  const endpoint = midenNetworks[network === "miden-mainnet" ? "mainnet" : "testnet"];
  const rpc = new RpcClient(new Endpoint(endpoint.rpcUrl));
  const resources: { free(): void }[] = [rpc];
  try {
    const id = parseMidenAccountId(faucetId);
    resources.push(id);
    const fetched = await rpc.getAccountDetails(id);
    resources.push(fetched);
    const account = fetched.account();
    if (!account) return undefined;
    // fromAccount consumes the account wrapper.
    const faucet = BasicFungibleFaucetComponent.fromAccount(account);
    resources.push(faucet);
    const symbol = faucet.symbol();
    resources.push(symbol);
    return { decimals: faucet.decimals(), symbol: symbol.toString() };
  } finally {
    resources.reverse().forEach(resource => resource.free?.());
  }
}

/** Return an exact note's inclusion block, or undefined when it is not found. */
export async function getMidenNoteBlock(noteId: string, recovery?: BridgeConfig): Promise<number | undefined> {
  const { Endpoint, NoteId, RpcClient } = await import("@miden-sdk/miden-sdk");
  const rpc = new RpcClient(new Endpoint(configMidenNetwork(recovery).rpcUrl));
  const resources: { free(): void }[] = [rpc];
  try {
    // The RPC consumes the note ID array; fetched notes and their getters are owned here.
    const notes = await rpc.getNotesById([NoteId.fromHex(noteId)]);
    resources.push(...notes);
    const note = notes.find(note => {
      const fetchedId = note.noteId;
      resources.push(fetchedId);
      return fetchedId.toString() === noteId;
    });
    if (!note) return undefined;
    const proof = note.inclusionProof;
    resources.push(proof);
    const location = proof.location();
    resources.push(location);
    return location.blockNum();
  } finally {
    resources.reverse().forEach(resource => resource.free());
  }
}
