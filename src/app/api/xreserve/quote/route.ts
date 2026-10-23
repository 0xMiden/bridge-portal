import { assertCurrentConfig, ConfigRequestError } from "../../../../config/wallet-config/server";
import { parseCctpQuoteRequest, requestCircleQuote } from "../../../../bridge/providers/xreserve/circle-api.server";
import { reportCircleFailure } from "../../../../bridge/providers/xreserve/circle-http.server";

export const dynamic = "force-dynamic";
const invalidRequest = () => Response.json(
  { error: "Enter a valid amount, wallet and Miden recipient." }, { status: 400 },
);

export async function POST(request: Request) {
  let input: ReturnType<typeof parseCctpQuoteRequest>;
  try {
    input = parseCctpQuoteRequest(await request.json());
    assertCurrentConfig(input.recovery, input.network, "receive");
  } catch (error) {
    if (error instanceof ConfigRequestError) return Response.json({ error: error.message }, { status: 409, headers: { "Cache-Control": "no-store" } });
    return invalidRequest();
  }
  try {
    return Response.json(await requestCircleQuote(input), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    reportCircleFailure("quote", error);
    return Response.json({ error: "Circle quote unavailable. Please retry shortly." }, {
      status: 502, headers: { "Cache-Control": "no-store" },
    });
  }
}
