import { bridgeConfigSchema } from "../../../../config/wallet-config/schema";
import type { BridgeConfig } from "../../../../config/bridge-config";
import { NextResponse } from "next/server";
import {
  type AgglayerDeposit,
  type AgglayerDepositStatus,
  bridgeStatusUrl,
} from "../../../../bridge/providers/agglayer/agglayer";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const destinationAddress = searchParams.get("destinationAddress") ?? "";
  let recovery: BridgeConfig;
  try {
    const body = await request.json();
    recovery = bridgeConfigSchema.parse(body.recovery);
  } catch { return NextResponse.json({ error: "Invalid recovery context." }, { status: 400 }); }
  const sourceTxHash = searchParams.get("sourceTxHash")?.toLowerCase();

  if (!/^0x[0-9a-fA-F]{40}$/.test(destinationAddress)) {
    return NextResponse.json({ error: "destinationAddress must be a 20-byte hex address." }, { status: 400 });
  }
  if (sourceTxHash !== undefined && !/^0x[0-9a-f]{64}$/.test(sourceTxHash)) {
    return NextResponse.json({ error: "sourceTxHash must be a 32-byte transaction hash." }, { status: 400 });
  }

  const url = new URL(bridgeStatusUrl(destinationAddress, recovery));
  const pageSize = sourceTxHash ? 100 : 1;
  url.searchParams.set("limit", String(pageSize));
  let offset = 0;
  let deposits: AgglayerDeposit[] = [];
  let latestDeposit: AgglayerDeposit | null = null;

  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]);
  let pages = 0;
  // Later deposits must not hide the transfer being tracked. Search by its
  // source transaction, including older pages, instead of assuming the latest.
  for (;;) {
    if (++pages > 50) return NextResponse.json({ error: "Deposit search limit reached. Retry later." }, { status: 502 });
    url.searchParams.set("offset", String(offset));
    const response = await fetch(url.toString(), {
      headers: { accept: "application/json" },
      cache: "no-store",
      redirect: "manual",
      signal,
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
