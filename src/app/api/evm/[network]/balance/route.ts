import { formatUnits } from "viem";
import { evmNetworks, isEvmNetwork } from "../../../../../config/evm-networks";
import { evmRpc } from "../../../../../bridge/evm/rpc.server";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ network: string }> }) {
  const { network } = await context.params;
  if (!isEvmNetwork(network)) return Response.json({ error: "Unsupported EVM network." }, { status: 400 });
  const params = new URL(request.url).searchParams;
  const address = params.get("address") ?? "";
  const token = params.get("token");
  const decimals = token === null ? evmNetworks[network].nativeCurrency.decimals : Number(params.get("decimals") ?? "18");
  if (!/^0x[\da-f]{40}$/i.test(address) ||
      (token !== null && !/^0x[\da-f]{40}$/i.test(token)) ||
      !Number.isInteger(decimals) || decimals < 0 || decimals > 255)
    return Response.json({ error: "Invalid address, token or decimals." }, { status: 400 });
  try {
    const result = token === null
      ? await evmRpc<`0x${string}`>(network, "eth_getBalance", [address, "latest"])
      : await evmRpc<`0x${string}`>(network, "eth_call", [{
          to: token, data: `0x70a08231${address.slice(2).toLowerCase().padStart(64, "0")}`,
        }, "latest"]);
    const raw = BigInt(result);
    return Response.json({ balanceRaw: raw.toString(), balance: formatUnits(raw, decimals) }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ error: "Unable to read this network's balance." }, { status: 502 });
  }
}
