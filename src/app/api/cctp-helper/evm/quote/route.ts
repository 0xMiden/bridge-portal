import { quoteEvmHelper } from "../../../../../bridge/providers/xreserve/helper-evm.server";
import { limitManualRequest, manualApi, manualRequestJson } from "../../../../../bridge/providers/xreserve/helper-manual.server";
export const dynamic = "force-dynamic";
export function POST(request: Request) { return manualApi(async () => {
  limitManualRequest("evm-quote");
  return quoteEvmHelper(await manualRequestJson(request));
}); }
