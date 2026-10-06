import { Endpoint, RpcClient } from "@miden-sdk/miden-sdk";

/** Eager WASM module; only import within the client-side Epoch flow. */
const MIDEN_RPC_URL =
  process.env.NEXT_PUBLIC_MIDEN_RPC_URL ?? "https://rpc.testnet.miden.io";

/** Read the chain head when minting a note with the SDK's reclaim window. */
export async function getCurrentMidenBlock(): Promise<number> {
  const header = await new RpcClient(new Endpoint(MIDEN_RPC_URL))
    .getBlockHeaderByNumber(undefined);
  return Number(header.blockNum());
}
