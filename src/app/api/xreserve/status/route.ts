import { bridgeConfigSchema } from "../../../../config/wallet-config/schema";
import { z } from "zod";
import { cctpNetworks, isCctpNetwork } from "../../../../bridge/providers/xreserve/config";
import { getCctpStatus } from "../../../../bridge/providers/xreserve/cctp-status";
import { getArcDepositStatus, UnsupportedArcDepositError } from "../../../../bridge/providers/xreserve/arc-status-server";
import { assertConfigNetwork } from "../../../../config/bridge-config";
import { reportCircleFailure } from "../../../../bridge/providers/xreserve/circle-http.server";
import { transactionHashSchema } from "../../../../bridge/evm/evm-schema";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  network: z.enum(["arc-testnet", "arc", ...cctpNetworks]),
  hash: transactionHashSchema,
  recovery: bridgeConfigSchema,
});

export async function POST(request: Request) {
  const params = new URL(request.url).searchParams;
  let body: { recovery?: unknown };
  try { body = await request.json(); }
  catch { return Response.json({ error: "Invalid recovery context." }, { status: 400 }); }
  const parsed = requestSchema.safeParse({
    network: params.get("network"), hash: params.get("hash"), recovery: body?.recovery,
  });
  if (!parsed.success) return Response.json({ error: "Invalid transfer request." }, { status: 400 });
  const { network, hash, recovery } = parsed.data;
  try { assertConfigNetwork(recovery, network); }
  catch { return Response.json({ error: "Invalid bridge deployment." }, { status: 400 }); }
  try {
    const status = isCctpNetwork(network)
      ? await getCctpStatus(network, hash, recovery)
      : await getArcDepositStatus(hash, recovery);
    return Response.json(status);
  } catch (error) {
    if (!isCctpNetwork(network) && error instanceof UnsupportedArcDepositError) {
      return Response.json({ error: error.message }, { status: 422 });
    }
    reportCircleFailure("status", error);
    const message = isCctpNetwork(network)
      ? "Unable to verify this transfer yet. Tracking will retry; keep its transaction hash."
      : "Unable to refresh this deposit. Keep its transaction hash; do not deposit again.";
    return Response.json({ error: message }, { status: 502 });
  }
}
