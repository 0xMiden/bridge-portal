import { z } from "zod";
import { solanaSignature } from "../../../../../config/cctp-helper";
import { helperObservationRequestSchema, limitManualRequest, manualApi, manualRequestJson, readManualHelperTransfer } from "../../../../../bridge/providers/xreserve/helper-manual.server";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return manualApi(async () => {
    const query = z.object({ deploymentId: z.string().max(80), sourceTransaction: solanaSignature }).strict().parse(Object.fromEntries(new URL(request.url).searchParams));
    limitManualRequest(`attestation:${query.deploymentId}`);
    return readManualHelperTransfer(query.deploymentId, query.sourceTransaction);
  });
}
export async function POST(request: Request) {
  return manualApi(async () => {
    const input = helperObservationRequestSchema.parse(await manualRequestJson(request, 65_536));
    limitManualRequest(`attestation:${input.deploymentId}`);
    return readManualHelperTransfer(input.deploymentId, input.sourceTransaction, input);
  });
}
