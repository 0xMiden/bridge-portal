import { bridgeConfigSchema } from "../../../../config/wallet-config/schema";
import type { BridgeConfig } from "../../../../config/bridge-config";
import { recoverWithdrawalExitHashes } from "../../../../bridge/providers/agglayer/withdrawal-recovery.server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const hash = new URL(request.url).searchParams.get("sourceTxHash") ?? "";
  if (!/^0x[\da-f]{64}$/i.test(hash)) return Response.json({ error: "Invalid Miden transaction hash." }, { status: 400 });
  let recovery: BridgeConfig;
  try { recovery = bridgeConfigSchema.parse((await request.json()).recovery); }
  catch { return Response.json({ error: "Invalid recovery context." }, { status: 400 }); }
  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]);
    return Response.json({ exitHashes: await recoverWithdrawalExitHashes(hash, recovery, signal) });
  } catch {
    return Response.json({ error: "Unable to verify the withdrawal on Miden. Tracking will retry." }, { status: 502 });
  }
}
