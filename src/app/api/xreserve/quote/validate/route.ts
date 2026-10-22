import { isCctpNetwork } from "../../../../../bridge/providers/xreserve/cctp-config";
import { requestCircleQuoteValidation } from "../../../../../bridge/providers/xreserve/cctp-quote-validation";
import { arcRecipient, parseArcAmount } from "../../../../../bridge/providers/xreserve/deposit";
import { assertMidenAccountNetwork } from "../../../../../wallets/miden/network";
import { assertDeploymentNetwork, getDeployment } from "../../../../../config/deployments";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  let input;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 16_384) throw new Error();
    input = JSON.parse(raw);
    if (!input || !isCctpNetwork(input.network) || typeof input.sender !== "string" ||
        !/^0x[\da-f]{40}$/i.test(input.sender) || typeof input.amount !== "string" ||
        typeof input.recipient !== "string" || typeof input.fee !== "string" || !/^\d+$/.test(input.fee) ||
        typeof input.signedQuote !== "string" || !/^0x(?:[\da-f]{2})+$/i.test(input.signedQuote) ||
        (input.deploymentId !== undefined && typeof input.deploymentId !== "string")) throw new Error();
    parseArcAmount(input.amount);
    assertDeploymentNetwork(input.deploymentId, input.network);
    assertMidenAccountNetwork(input.recipient, getDeployment(input.deploymentId).environment);
    arcRecipient(input.recipient);
  } catch {
    return Response.json({ error: "Enter a valid quote, wallet and Miden recipient." }, { status: 400 });
  }
  try {
    return Response.json(await requestCircleQuoteValidation(input), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Circle quote validation unavailable. Please retry shortly." }, {
      status: 502, headers: { "Cache-Control": "no-store" },
    });
  }
}
