import { NextResponse } from "next/server";
import { formatGwei } from "viem";

import { evmRpc } from "../../../../../bridge/evm/rpc.server";
import { isEvmNetwork } from "../../../../../config/evm-networks";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ network: string }> }) {
  const { network } = await context.params;
  if (!isEvmNetwork(network)) return NextResponse.json({ error: "Unsupported EVM network." }, { status: 400 });
  try {
    const result = await evmRpc<`0x${string}`>(network, "eth_gasPrice", []);
    const gasPriceWei = BigInt(result);
    return NextResponse.json({
      gasPriceWei: gasPriceWei.toString(),
      gwei: formatGwei(gasPriceWei),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "EVM RPC error.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
