import { NextResponse } from "next/server";
import { getDeployment } from "../../../../config/deployments";
import {
  type AgglayerDeposit,
  type AgglayerDepositStatus,
  bridgeStatusUrl,
} from "../../../../bridge/providers/agglayer/agglayer";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const destinationAddress = searchParams.get("destinationAddress") ?? "";
  const deploymentId = searchParams.get("deployment") ?? undefined;
  const sourceTxHash = searchParams.get("sourceTxHash")?.toLowerCase();
  try { getDeployment(deploymentId); }
  catch { return NextResponse.json({ error: "Invalid bridge deployment." }, { status: 400 }); }

  if (!/^0x[0-9a-fA-F]{40}$/.test(destinationAddress)) {
    return NextResponse.json({ error: "destinationAddress must be a 20-byte hex address." }, { status: 400 });
  }
  if (sourceTxHash !== undefined && !/^0x[0-9a-f]{64}$/.test(sourceTxHash)) {
    return NextResponse.json({ error: "sourceTxHash must be a 32-byte transaction hash." }, { status: 400 });
  }

  const url = new URL(bridgeStatusUrl(destinationAddress, deploymentId));
  const pageSize = sourceTxHash ? 100 : 1;
  url.searchParams.set("limit", String(pageSize));
  let offset = 0;
  let deposits: AgglayerDeposit[] = [];
  let latestDeposit: AgglayerDeposit | null = null;

  // Later deposits must not hide the transfer being tracked. Search by its
  // source transaction, including older pages, instead of assuming the latest.
  for (;;) {
    url.searchParams.set("offset", String(offset));
    const response = await fetch(url.toString(), {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: request.signal,
    });
    if (!response.ok) {
      return NextResponse.json(
        { error: `Bridge service returned ${response.status}.` },
        { status: 502 },
      );
    }

    const payload = (await response.json()) as { deposits?: AgglayerDeposit[]; total_cnt?: string };
    const page = Array.isArray(payload.deposits) ? payload.deposits : [];
    latestDeposit ??= page[0] ?? null;
    deposits = sourceTxHash
      ? page.filter((deposit) => deposit.tx_hash?.toLowerCase() === sourceTxHash)
      : page;
    offset += page.length;
    if (!sourceTxHash || deposits.length > 0 || page.length === 0 ||
        offset >= Number(payload.total_cnt) ||
        (payload.total_cnt === undefined && page.length < pageSize)) break;
  }
  const body: AgglayerDepositStatus = {
    destinationAddress,
    deposits,
    latestDeposit,
  };

  return NextResponse.json(body);
}
