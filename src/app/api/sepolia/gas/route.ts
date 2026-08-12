import { NextResponse } from "next/server";
import { formatGwei } from "viem";

import { getSepoliaRpcUrl } from "../rpc";

const sepoliaRpcUrl = getSepoliaRpcUrl();

export const dynamic = "force-dynamic";

async function rpc(method: string, params: unknown[]) {
  const response = await fetch(sepoliaRpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    next: { revalidate: 0 },
  });
  if (!response.ok) throw new Error(`Sepolia RPC returned ${response.status}.`);
  const payload = (await response.json()) as {
    result?: `0x${string}`;
    error?: { message?: string };
  };
  if (!payload.result) {
    throw new Error(payload.error?.message ?? "Sepolia RPC did not return a result.");
  }
  return payload.result;
}

// Live Sepolia gas price, used to turn a route's gas-limit estimate into an
// actual network-fee number (gasPrice * gasLimit) on the client.
export async function GET() {
  try {
    const result = await rpc("eth_gasPrice", []);
    const gasPriceWei = BigInt(result);
    return NextResponse.json({
      gasPriceWei: gasPriceWei.toString(),
      gwei: formatGwei(gasPriceWei),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sepolia RPC error.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
