import type { BridgeConfig } from "../../../config/bridge-config";
import { Endpoint, RpcClient } from "@miden-sdk/miden-sdk";

import { configMidenNetwork } from "../../../config/bridge-config";

/** Read the chain head when minting a note with the SDK's reclaim window. */
export async function getCurrentMidenBlock(recovery?: BridgeConfig): Promise<number> {
  const header = await new RpcClient(new Endpoint(configMidenNetwork(recovery).rpcUrl))
    .getBlockHeaderByNumber(undefined);
  return Number(header.blockNum());
}
