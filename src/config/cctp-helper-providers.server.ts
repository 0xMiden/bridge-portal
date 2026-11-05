import "server-only";
import { z } from "zod";

type ProviderVariable = "CCTP_HELPER_SERVERS_JSON" | "CCTP_EVM_HELPER_SERVERS_JSON";

/** Runtime secrets replace tracked rows; only a qualified deployment selects a row. */
export function resolveHelperProvider<T extends { deploymentId: string; irisApi: string }>(
  variable: ProviderVariable, tracked: unknown, schema: z.ZodType<T>,
  deployment: { deploymentId: string; environment: "mainnet" | "testnet" },
): T {
  try {
    const raw = process.env[variable];
    if (raw !== undefined && raw.length > 65_536) throw new Error();
    const rows = z.array(schema).max(64).parse(raw === undefined ? tracked : JSON.parse(raw));
    if (new Set(rows.map(row => row.deploymentId)).size !== rows.length) throw new Error();
    const server = rows.find(row => row.deploymentId === deployment.deploymentId);
    if (!server) throw new Error();
    const iris = new URL(server.irisApi);
    const expected = deployment.environment === "mainnet"
      ? "https://iris-api.circle.com" : "https://iris-api-sandbox.circle.com";
    if (!["127.0.0.1", "localhost", "[::1]"].includes(iris.hostname) && iris.origin !== expected)
      throw new Error();
    return server;
  } catch {
    // Never retain parse errors, rejected values, URLs or credential-bearing causes.
    throw new Error(`Configure ${variable} server-side with one valid provider row for the selected qualified deployment.`);
  }
}
