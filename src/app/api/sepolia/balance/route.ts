import { NextResponse } from "next/server";
import { formatEther, formatUnits } from "viem";

import { sepoliaRpc } from "../../../lib/sepolia-rpc";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address") ?? "";
  const token = searchParams.get("token");
  const decimals = Number(searchParams.get("decimals") ?? "18");

  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return NextResponse.json({ error: "address must be a 20-byte hex address." }, { status: 400 });
  }

  try {
    // ERC-20 balance when a token address is supplied; native ETH otherwise.
    if (token && /^0x[0-9a-fA-F]{40}$/.test(token)) {
      const data = `0x70a08231${address.slice(2).toLowerCase().padStart(64, "0")}`;
      const result = await sepoliaRpc<`0x${string}`>("eth_call", [{ to: token, data }, "latest"]);
      const raw = BigInt(result);
      return NextResponse.json({
        address,
        token,
        balanceRaw: raw.toString(),
        balance: formatUnits(raw, Number.isFinite(decimals) ? decimals : 18),
      });
    }

    const result = await sepoliaRpc<`0x${string}`>("eth_getBalance", [address, "latest"]);
    const balanceWei = BigInt(result);
    return NextResponse.json({
      address,
      balanceWei: balanceWei.toString(),
      balanceEth: formatEther(balanceWei),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sepolia RPC error.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
