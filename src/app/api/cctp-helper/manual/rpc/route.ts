import { z } from "zod";
import { helperServer } from "../../../../../config/cctp-helper.server";
import { boundedText } from "../../../../../bridge/solana/rpc";
import { limitManualRequest, manualApi, manualRequestJson } from "../../../../../bridge/providers/xreserve/helper-manual.server";
import { manualRpcRequestSchema } from "../../../../../bridge/solana/rpc-request";
import { validateHelperTransactionBytes } from "../../../../../bridge/providers/xreserve/helper-solana";
import { assertManualDestination } from "../../../../../bridge/providers/xreserve/helper-preflight.server";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return manualApi(async () => {
    const query = z.object({ deploymentId: z.string().max(80) }).strict().parse(Object.fromEntries(new URL(request.url).searchParams));
    const input = manualRpcRequestSchema.parse(await manualRequestJson(request, 8192));
    const { server, deployment } = helperServer(query.deploymentId, input.method === "sendTransaction");
    limitManualRequest(`rpc:${query.deploymentId}`);
    if (input.method === "sendTransaction" || input.method === "simulateTransaction") {
      const { authorization } = await validateHelperTransactionBytes(Buffer.from(input.params[0], "base64"), deployment, input.method === "sendTransaction");
      await assertManualDestination(deployment, server, authorization.midenRecipient, {
        grossAmount: BigInt(authorization.grossAmount), netAmount: BigInt(authorization.grossAmount), phase: "source-admission",
      });
    }
    const response = await fetch(server.solanaRpc, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(input), signal: AbortSignal.timeout(12_000), cache: "no-store" });
    if (!response.ok) throw new Error("Source transport unavailable.");
    return JSON.parse(await boundedText(response)) as unknown;
  });
}
