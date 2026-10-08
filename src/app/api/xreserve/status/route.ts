import { isCctpNetwork } from "../../../../bridge/providers/xreserve/cctp-config";
import { getCctpStatus } from "../../../../bridge/providers/xreserve/cctp-status";
import { getArcDepositStatus } from "../../../../bridge/providers/xreserve/arc-status-server";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const network = params.get("network") ?? "";
  const hash = params.get("hash") ?? "";
  if ((network !== "arc-testnet" && !isCctpNetwork(network)) || !/^0x[\da-f]{64}$/i.test(hash))
    return Response.json({ error: "Invalid transfer request." }, { status: 400 });
  if (network === "arc-testnet") return getArcDepositStatus(hash);
  try {
    return Response.json(await getCctpStatus(network, hash as `0x${string}`));
  } catch {
    return Response.json({ error: "Unable to verify this transfer yet. Tracking will retry; keep its transaction hash." }, { status: 502 });
  }
}
