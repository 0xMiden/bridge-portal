import { NextResponse } from "next/server";
import { formatGwei } from "viem";

import { sepoliaRpc } from "../../../lib/sepolia-rpc";

export const dynamic = "force-dynamic";

// Live Sepolia gas price, used to turn a route's gas-limit estimate into an
// actual network-fee number (gasPrice * gasLimit) on the client.
export async function GET() {
  try {
    const result = await sepoliaRpc<`0x${string}`>("eth_gasPrice", []);
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
