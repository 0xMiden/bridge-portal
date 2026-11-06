import { z } from "zod";
import { helperServer } from "../../../../../config/cctp-helper.server";
import { boundedText } from "../../../../../bridge/solana/rpc";
import { limitManualRequest, manualApi, manualRequestJson } from "../../../../../bridge/providers/xreserve/helper-manual.server";
import { manualRpcRequestSchema } from "../../../../../bridge/solana/rpc-request";
import { validateHelperTransactionBytes } from "../../../../../bridge/providers/xreserve/helper-solana";
import { assertManualDestination } from "../../../../../bridge/providers/xreserve/helper-preflight.server";
export const dynamic = "force-dynamic";
const responseSchema = z.object({ jsonrpc: z.literal("2.0"), id: z.union([z.string(), z.number()]),
  result: z.unknown().optional(), error: z.object({ code: z.number().int() }).optional() });
function publicRpcResponse(value: unknown, id: string | number) {
  const parsed = responseSchema.safeParse(value);
  if (!parsed.success) throw new Error("Source transport unavailable.");
  const body = parsed.data, hasResult = Object.hasOwn(body, "result");
  if (body.id !== id || hasResult === Object.hasOwn(body, "error")) throw new Error("Source transport unavailable.");
  if (body.error) return { jsonrpc: "2.0", id, error: { code: body.error.code, message: "Source RPC request failed." } };
  return { jsonrpc: "2.0", id, result: body.result };
}
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
    return publicRpcResponse(JSON.parse(await boundedText(response)), input.id);
  });
}
