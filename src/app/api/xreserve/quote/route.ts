import { parseCctpQuoteRequest, requestCircleQuote } from "../../../../bridge/providers/xreserve/circle-api.server";
import { reportCircleFailure } from "../../../../bridge/providers/xreserve/circle-http.server";

export const dynamic = "force-dynamic";
const invalidRequest = () => Response.json(
  { error: "Enter a valid amount, wallet and Miden recipient." }, { status: 400 },
);

export async function POST(request: Request) {
  let input: ReturnType<typeof parseCctpQuoteRequest>;
  try {
    const raw = await request.text();
    if (raw.length > 2048) return invalidRequest();
    input = parseCctpQuoteRequest(JSON.parse(raw));
  } catch {
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
