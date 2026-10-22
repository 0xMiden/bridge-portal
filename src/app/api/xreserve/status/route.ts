import { z } from "zod";
import { cctpNetworks, isCctpNetwork } from "../../../../bridge/providers/xreserve/config";
import { getCctpStatus } from "../../../../bridge/providers/xreserve/cctp-status";
import { getArcDepositStatus, UnsupportedArcDepositError } from "../../../../bridge/providers/xreserve/arc-status-server";
import { assertDeploymentNetwork } from "../../../../config/deployments";
import { reportCircleFailure } from "../../../../bridge/providers/xreserve/circle-http.server";
import { transactionHashSchema } from "../../../../bridge/evm/evm-schema";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  network: z.enum(["arc-testnet", "arc", ...cctpNetworks]),
  hash: transactionHashSchema,
  deploymentId: z.string().optional(),
});

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const parsed = requestSchema.safeParse({
    network: params.get("network"), hash: params.get("hash"), deploymentId: params.get("deployment") ?? undefined,
  });
  if (!parsed.success) return Response.json({ error: "Invalid transfer request." }, { status: 400 });
  const { network, hash, deploymentId } = parsed.data;
  try { assertDeploymentNetwork(deploymentId, network); }
  catch { return Response.json({ error: "Invalid bridge deployment." }, { status: 400 }); }
  try {
    const status = isCctpNetwork(network)
      ? await getCctpStatus(network, hash, deploymentId)
      : await getArcDepositStatus(hash, deploymentId);
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
