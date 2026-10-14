import { requestWithdrawalQuote, validateWithdrawalQuoteRequest, type WithdrawalQuoteRequest } from "../../../../bridge/providers/xreserve/withdrawal-quote";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  let input: WithdrawalQuoteRequest;
  try {
    const raw = await request.text();
    if (raw.length > 2048) throw new Error();
    input = JSON.parse(raw);
    if (!input || typeof input.amount !== "string" || typeof input.sender !== "string" ||
        typeof input.recipient !== "string" || typeof input.network !== "string") throw new Error();
    validateWithdrawalQuoteRequest(input);
  } catch {
    return Response.json({ error: "Enter a valid withdrawal amount, Miden sender and destination address." }, { status: 400 });
  }
  try {
    return Response.json(await requestWithdrawalQuote(input), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Withdrawal estimate unavailable." }, { status: 502 });
  }
}
