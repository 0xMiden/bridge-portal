import { z } from "zod";
import { getDeployment } from "../../../../config/deployments";
import { readDepositStatus } from "../../../../bridge/providers/agglayer/agglayer-status";

export const dynamic = "force-dynamic";
const querySchema = z.object({
  destinationAddress: z.string().regex(/^0x[\da-f]{40}$/i),
  sourceTxHash: z.string().regex(/^0x[\da-f]{64}$/i).optional(),
  deployment: z.string().optional(),
});

export async function GET(request: Request) {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ error: "Invalid Agglayer deposit query." }, { status: 400 });
  const { destinationAddress, deployment, sourceTxHash } = parsed.data;
  try { getDeployment(deployment); }
  catch { return Response.json({ error: "Invalid bridge deployment." }, { status: 400 }); }
  try {
    const status = await readDepositStatus({
      destination: destinationAddress, deploymentId: deployment, signal: request.signal,
    }, sourceTxHash);
    return Response.json(status);
  } catch {
    return Response.json({ error: "Unable to read Agglayer deposits. Tracking will retry." }, { status: 502 });
  }
}
