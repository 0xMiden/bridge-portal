import { observeEvmHelper } from "../../../../../bridge/providers/xreserve/helper-evm.server";
import { limitManualRequest, manualApi, manualRequestJson } from "../../../../../bridge/providers/xreserve/helper-manual.server";
export const dynamic = "force-dynamic";
export function POST(request: Request) { return manualApi(async () => {
  limitManualRequest("evm-attestation");
  return observeEvmHelper(await manualRequestJson(request, 32_000));
}); }
