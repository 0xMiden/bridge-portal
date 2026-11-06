import "server-only";
import { z } from "zod";
import entries from "./cctp-helper-server.json";
import { address, getHelperDeployment } from "./cctp-helper";
import { resolveHelperProvider } from "./cctp-helper-providers.server";

const endpoint = z.url().refine(value => {
  const url = new URL(value);
  return !url.username && !url.password && (url.protocol === "https:" ||
    (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)));
});
export const helperServerSchema = z.object({ deploymentId: z.string().max(80), solanaRpc: endpoint,
  arcRpc: endpoint, irisApi: endpoint, simulationCaller: address }).strict();
export type HelperServer = z.infer<typeof helperServerSchema>;
export function helperServer(id: string, requireEnabled = false) {
  const deployment = getHelperDeployment(id, requireEnabled);
  const server = resolveHelperProvider("CCTP_HELPER_SERVERS_JSON", entries, helperServerSchema, deployment);
  return { deployment, server };
}
