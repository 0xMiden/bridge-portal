import { z } from "zod";
import { bridgeConfigSchema } from "../../../../config/wallet-config/schema";
import type { BridgeConfig } from "../../../../config/bridge-config";
import { readDepositStatus } from "../../../../bridge/providers/agglayer/agglayer-status";

export const dynamic = "force-dynamic";
const querySchema = z.object({
  destinationAddress: z.string().regex(/^0x[\da-f]{40}$/i),
  sourceTxHash: z.string().regex(/^0x[\da-f]{64}$/i).optional(),
});

export async function POST(request: Request) {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ error: "Invalid Agglayer deposit query." }, { status: 400 });
  let recovery: BridgeConfig;
  try { recovery = bridgeConfigSchema.parse((await request.json()).recovery); }
  catch { return Response.json({ error: "Invalid recovery context." }, { status: 400 }); }
  const { destinationAddress, sourceTxHash } = parsed.data;
  try {
    const status = await readDepositStatus({
      destination: destinationAddress, recovery, signal: request.signal,
    }, sourceTxHash);
    return Response.json(status);
  } catch {
    return Response.json({ error: "Unable to read Agglayer deposits. Tracking will retry." }, { status: 502 });
  }
}
