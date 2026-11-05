import "server-only";
import { z } from "zod";
import entries from "./cctp-evm-helper-server.json";
import { helperServerSchema } from "./cctp-helper.server";
import { getEvmHelperDeployment } from "./cctp-evm-helper";
export const evmHelperServerSchema = helperServerSchema.omit({ solanaRpc: true }).extend({
  sourceRpc: helperServerSchema.shape.solanaRpc,
}).strict();
export type EvmHelperServer = z.infer<typeof evmHelperServerSchema>;
const registry = z.array(evmHelperServerSchema).parse(entries);
export function evmHelperServer(id: string, enabled = false) {
  const deployment = getEvmHelperDeployment(id, enabled);
  const rows = registry.filter(row => row.deploymentId === id);
  if (rows.length !== 1) throw new Error("Historical EVM helper deployment unavailable.");
  const server = rows[0], iris = new URL(server.irisApi);
  const expected = deployment.environment === "mainnet" ? "https://iris-api.circle.com" : "https://iris-api-sandbox.circle.com";
  if (!["localhost", "127.0.0.1", "[::1]"].includes(iris.hostname) && iris.origin !== expected) throw new Error("Wrong Circle environment.");
  return { deployment, server };
}
