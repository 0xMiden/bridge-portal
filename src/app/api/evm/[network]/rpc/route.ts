import { isEvmNetwork } from "../../../../../config/evm-networks";
import { forwardEvmRpc } from "../../../../../bridge/evm/rpc.server";

// Only public reads/simulations. Transactions go through the user's wallet.
const readMethods = new Set([
  "eth_chainId", "eth_call", "eth_getBalance", "eth_getCode",
  "eth_getTransactionReceipt", "eth_getTransactionByHash", "eth_blockNumber",
  "eth_getBlockByNumber", "eth_getBlockByHash", "eth_getTransactionCount",
  "eth_estimateGas", "eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_feeHistory",
]);

export async function POST(request: Request, context: { params: Promise<{ network: string }> }) {
  const { network } = await context.params;
  if (!isEvmNetwork(network)) return Response.json({ error: "Unsupported EVM network." }, { status: 400 });
  let body;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 32_768)
      return Response.json({ error: "RPC request too large." }, { status: 413 });
    body = JSON.parse(raw);
    if (!body || Array.isArray(body) || body.jsonrpc !== "2.0" ||
        (typeof body.id !== "number" && typeof body.id !== "string") ||
        typeof body.method !== "string" || !readMethods.has(body.method) ||
        (body.params !== undefined && !Array.isArray(body.params)))
      return Response.json({ error: "Unsupported EVM read request." }, { status: 400 });
  } catch {
    return Response.json({ error: "Invalid RPC request." }, { status: 400 });
  }
  try {
    return Response.json(await forwardEvmRpc(network, body), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ jsonrpc: "2.0", id: body.id, error: {
      code: -32000, message: error instanceof Error ? error.message : "EVM RPC unavailable.",
    } }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
