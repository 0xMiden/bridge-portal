import { Endpoint, RpcClient } from "@miden-sdk/miden-sdk";

import { deploymentMiden } from "../../../config/deployments";

/** Read the chain head when minting a note with the SDK's reclaim window. */
export async function getCurrentMidenBlock(deploymentId?: string): Promise<number> {
  const header = await new RpcClient(new Endpoint(deploymentMiden(deploymentId).rpcUrl))
    .getBlockHeaderByNumber(undefined);
  return Number(header.blockNum());
}
