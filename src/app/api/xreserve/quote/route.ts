import { isCctpNetwork } from "../../../../bridge/providers/xreserve/cctp-config";
import { requestCircleQuote } from "../../../../bridge/providers/xreserve/cctp-quote";
import { arcRecipient, parseArcAmount } from "../../../../bridge/providers/xreserve/deposit";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  let input;
  try {
    const raw = await request.text();
    if (raw.length > 2048) throw new Error();
    input = JSON.parse(raw);
    if (!input || !isCctpNetwork(input.network) || !/^0x[\da-f]{40}$/i.test(input.sender) ||
        typeof input.amount !== "string" || typeof input.recipient !== "string") throw new Error();
    parseArcAmount(input.amount);
    arcRecipient(input.recipient);
  } catch {
    return Response.json({ error: "Enter a valid amount, wallet and Miden recipient." }, { status: 400 });
  }
  try {
    return Response.json(await requestCircleQuote(input), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Circle quote unavailable. Please retry shortly." }, { status: 502 });
  }
}
