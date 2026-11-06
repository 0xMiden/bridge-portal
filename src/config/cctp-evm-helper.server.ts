import "server-only";
import { z } from "zod";
import entries from "./cctp-evm-helper-server.json";
import { helperServerSchema } from "./cctp-helper.server";
import { getEvmHelperDeployment } from "./cctp-evm-helper";
import { resolveHelperProvider } from "./cctp-helper-providers.server";
export const evmHelperServerSchema = helperServerSchema.omit({ solanaRpc: true }).extend({
  sourceRpc: helperServerSchema.shape.solanaRpc,
}).strict();
export type EvmHelperServer = z.infer<typeof evmHelperServerSchema>;
export function evmHelperServer(id: string, enabled = false) {
  const deployment = getEvmHelperDeployment(id, enabled);
  const server = resolveHelperProvider("CCTP_EVM_HELPER_SERVERS_JSON", entries, evmHelperServerSchema, deployment);
  return { deployment, server };
}
