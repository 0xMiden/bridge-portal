import { getDeployment } from "../../../../config/deployments";
import { recoverWithdrawalExitHashes } from "../../../../bridge/providers/agglayer/withdrawal-recovery.server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const hash = params.get("sourceTxHash") ?? "";
  const deploymentId = params.get("deployment") ?? undefined;
  if (!/^0x[\da-f]{64}$/i.test(hash)) return Response.json({ error: "Invalid Miden transaction hash." }, { status: 400 });
  try { getDeployment(deploymentId); }
  catch { return Response.json({ error: "Invalid bridge deployment." }, { status: 400 }); }
  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]);
    return Response.json({ exitHashes: await recoverWithdrawalExitHashes(hash, deploymentId, signal) });
  } catch {
    return Response.json({ error: "Unable to verify the withdrawal on Miden. Tracking will retry." }, { status: 502 });
  }
}
