import { expect, it, vi } from "vitest";
import { createPublicClient, createWalletClient, custom } from "viem";
import { mainnet } from "viem/chains";
import { suggestEvmFees } from "./fee-suggestions";

it.each([
  { name: "RPC priority estimate", priority: "0x3", base: "0x64", expected: { maxFeePerGas: "0xcb", maxPriorityFeePerGas: "0x3" } },
  { name: "gas-price fallback", priority: null, base: "0x64", expected: { maxFeePerGas: "0xd2", maxPriorityFeePerGas: "0xa" } },
  { name: "non-EIP-1559 chain", priority: "0x3", base: null, expected: {} },
  { name: "unavailable fee RPCs", priority: null, base: "0x64", gasPriceFails: true, expected: {} },
])("serializes $name through viem without mixing legacy pricing", async ({ priority, base, gasPriceFails, expected }) => {
  // Exercise viem's actual RPC fallback and wallet serializer, not a mock of either.
  const rpc = createPublicClient({ chain: mainnet, transport: custom({ request: async ({ method }) => {
    if (method === "eth_getBlockByNumber") return { number: "0x1", baseFeePerGas: base, transactions: [] };
    if (method === "eth_maxPriorityFeePerGas" && priority !== null) return priority;
    if (method === "eth_gasPrice" && !gasPriceFails) return "0x6e";
    throw Object.assign(new Error("Unsupported method"), { code: -32601 });
  } }, { retryCount: 0 }) });
  const request = vi.fn(async ({ method }: { method: string }) => {
    if (method === "eth_chainId") return "0x1";
    if (method === "eth_sendTransaction") return `0x${"ab".repeat(32)}`;
    throw new Error(`Unexpected wallet method: ${method}`);
  });
  const wallet = createWalletClient({ chain: mainnet, transport: custom({ request }) });
  const fees = await suggestEvmFees(rpc);
  await wallet.sendTransaction({
    account: "0x1111111111111111111111111111111111111111",
    to: "0x2222222222222222222222222222222222222222", data: "0x1234", ...fees,
  });
  const sent = request.mock.calls.find(([call]) => call.method === "eth_sendTransaction")?.[0] as unknown as { params: Record<string, unknown>[] };
  const { from, to, data, ...fields } = sent.params[0];
  expect({ from, to, data }).toEqual({
    from: "0x1111111111111111111111111111111111111111",
    to: "0x2222222222222222222222222222222222222222", data: "0x1234",
  });
  expect(fields).toEqual(expected);
});
