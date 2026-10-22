import { parseCctpValidationRequest, requestCircleQuoteValidation } from "../../../../../bridge/providers/xreserve/circle-api.server";
import { reportCircleFailure } from "../../../../../bridge/providers/xreserve/circle-http.server";

export const dynamic = "force-dynamic";
const invalidRequest = () => Response.json(
  { error: "Enter a valid quote, wallet and Miden recipient." }, { status: 400 },
);

export async function POST(request: Request) {
  let input: ReturnType<typeof parseCctpValidationRequest>;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 16_384) return invalidRequest();
    input = parseCctpValidationRequest(JSON.parse(raw));
  } catch {
    return invalidRequest();
  }
  try {
    return Response.json(await requestCircleQuoteValidation(input), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    reportCircleFailure("validation", error);
    return Response.json({ error: "Circle quote validation unavailable. Please retry shortly." }, {
      status: 502, headers: { "Cache-Control": "no-store" },
    });
  }
}
