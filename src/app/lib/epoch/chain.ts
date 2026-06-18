import { Endpoint, RpcClient } from "@miden-sdk/miden-sdk";

import { MIDEN_MIN_RECLAIM_BLOCKS } from "./config";

/**
 * Miden testnet RPC. The `@miden-sdk/miden-sdk` "." entry is the eager build, so
 * the WASM is initialized on import — no explicit init needed here.
 */
const MIDEN_RPC_URL =
  process.env.NEXT_PUBLIC_MIDEN_RPC_URL ?? "https://rpc.testnet.miden.io";

function midenRpc(): RpcClient {
  const endpoint = MIDEN_RPC_URL
    ? new Endpoint(MIDEN_RPC_URL)
    : Endpoint.testnet();
  return new RpcClient(endpoint);
}

/**
 * Fetch the latest Miden chain head. Used to compute an ABSOLUTE P2IDE
 * `midenReclaimHeight` (`currentBlock + MIDEN_MIN_RECLAIM_BLOCKS`) before a
 * Miden→EVM quote/intent — a stale value makes the note reclaimable at creation
 * and the intent fails.
 */
export async function getCurrentMidenBlock(): Promise<number> {
  const header = await midenRpc().getBlockHeaderByNumber(undefined);
  return Number(header.blockNum());
}

export { MIDEN_MIN_RECLAIM_BLOCKS };
