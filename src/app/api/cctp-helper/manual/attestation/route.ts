import { z } from "zod";
import { solanaSignature } from "../../../../../config/cctp-helper";
import { limitManualRequest, manualApi, readManualHelperTransfer } from "../../../../../bridge/providers/xreserve/helper-manual.server";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return manualApi(async () => {
    const query = z.object({ deploymentId: z.string().max(80), sourceTransaction: solanaSignature }).strict().parse(Object.fromEntries(new URL(request.url).searchParams));
    limitManualRequest(`attestation:${query.deploymentId}`);
    return readManualHelperTransfer(query.deploymentId, query.sourceTransaction);
  });
}
