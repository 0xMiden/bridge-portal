import { assertCurrentConfig, ConfigRequestError } from "../../../../config/wallet-config/server";
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
    input = parseWithdrawalQuoteRequest(await request.json());
    assertCurrentConfig(input.recovery, input.network, "send");
  } catch (error) {
    if (error instanceof ConfigRequestError) return Response.json({ error: error.message }, { status: 409, headers: { "Cache-Control": "no-store" } });
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
