import { limitManualRequest, manualApi, manualRequestJson, quoteManualHelper } from "../../../../../bridge/providers/xreserve/helper-manual.server";
import { manualQuoteRequestSchema } from "../../../../../bridge/providers/xreserve/helper-types";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return manualApi(async () => {
    const input = manualQuoteRequestSchema.parse(await manualRequestJson(request));
    limitManualRequest(`quote:${input.deploymentId}`);
    return quoteManualHelper(input);
  });
}
