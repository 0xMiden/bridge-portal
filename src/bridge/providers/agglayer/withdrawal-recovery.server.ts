import type { BridgeConfig } from "../../../config/bridge-config";
import { getMidenTransactionNoteCommitments } from "../../miden-rpc.server";
import { agglayerExitHash } from "./exit-hash";

export async function recoverWithdrawalExitHashes(hash: string, recovery: BridgeConfig, signal: AbortSignal): Promise<string[]> {
  const commitments = await getMidenTransactionNoteCommitments(hash, recovery, signal);
  return commitments.map(agglayerExitHash);
}
