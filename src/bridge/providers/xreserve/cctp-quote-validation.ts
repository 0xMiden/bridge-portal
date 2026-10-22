import type { CctpBurnAuthorization } from "./cctp-burn";
import { cctpValidationSchema, type CctpQuoteValidation } from "./cctp-schema";
import { circleApiError, parseCirclePayload } from "./circle-schema";

export type { CctpQuoteValidation } from "./cctp-schema";

export async function fetchCctpQuoteValidation(quote: CctpBurnAuthorization): Promise<CctpQuoteValidation> {
  const response = await fetch("/api/xreserve/quote/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(quote),
    signal: AbortSignal.timeout(15_000),
  });
  const body: unknown = await response.json();
  if (!response.ok) throw circleApiError(body, "Circle quote validation unavailable. Please retry shortly.");
  return parseCirclePayload(cctpValidationSchema, body, "Circle returned an invalid quote validation. Please retry.");
}
