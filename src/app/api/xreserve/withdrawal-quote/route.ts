import { reportCircleFailure } from "../../../../bridge/providers/xreserve/circle-http.server";
import { parseWithdrawalQuoteRequest } from "../../../../bridge/providers/xreserve/withdrawal-quote";
import { requestWithdrawalQuote } from "../../../../bridge/providers/xreserve/withdrawal-quote.server";

export const dynamic = "force-dynamic";
const invalidRequest = () => Response.json(
  { error: "Enter a valid withdrawal amount, Miden sender and destination address." }, { status: 400 },
);

export async function POST(request: Request) {
  let input: ReturnType<typeof parseWithdrawalQuoteRequest>;
  try {
    const raw = await request.text();
    if (raw.length > 2048) return invalidRequest();
    input = parseWithdrawalQuoteRequest(JSON.parse(raw));
  } catch {
    return invalidRequest();
  }
  try {
    return Response.json(await requestWithdrawalQuote(input), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    reportCircleFailure("withdrawal", error);
    return Response.json({ error: "Withdrawal estimate unavailable. Please retry shortly." }, {
      status: 502, headers: { "Cache-Control": "no-store" },
    });
  }
}
