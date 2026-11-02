import "server-only";
import { z } from "zod";
import entries from "./cctp-helper-server.json";
import { address, getHelperDeployment } from "./cctp-helper";

const endpoint = z.url().refine(value => {
  const url = new URL(value);
  return !url.username && !url.password && (url.protocol === "https:" ||
    (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)));
});
export const helperServerSchema = z.object({ deploymentId: z.string().max(80), solanaRpc: endpoint,
  arcRpc: endpoint, irisApi: endpoint, simulationCaller: address }).strict();
const registry = z.array(helperServerSchema).parse(entries);
export type HelperServer = z.infer<typeof helperServerSchema>;
export function helperServer(id: string, requireEnabled = false) {
  const deployment = getHelperDeployment(id, requireEnabled), server = registry.find(entry => entry.deploymentId === id);
  if (!server || registry.filter(entry => entry.deploymentId === id).length !== 1) throw new Error("Historical deployment is unavailable.");
  const iris = new URL(server.irisApi);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(iris.hostname) && iris.origin !==
    (deployment.environment === "mainnet" ? "https://iris-api.circle.com" : "https://iris-api-sandbox.circle.com"))
    throw new Error("Wrong Circle environment.");
  return { deployment, server };
}
