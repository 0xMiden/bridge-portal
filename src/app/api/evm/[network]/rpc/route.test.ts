import { afterEach, expect, it, vi } from "vitest";
import { POST } from "./route";
import { evmRpcUrls } from "../../../../../bridge/evm/rpc.server";
import { evmReadTransport } from "../../../../../bridge/evm/transport";
import type { EvmNetwork } from "../../../../../bridge/core/assets";
const context = (network = "arc-testnet") => ({ params: Promise.resolve({ network }) });
const post = (request: Request) => POST(request, context());
const payload = {
  jsonrpc: "2.0",
  id: 7,
  method: "eth_call",
  params: [
    {
      to: "0x008888878f94C0d87defdf0B07f46B93C1934442",
      data: "0xf54a69c30000000000000000000000000000000000000000000000000000000000002717",
    },
    "latest",
  ],
};
const request = (body: unknown = payload) =>
  new Request("http://localhost/api/evm/arc-testnet/rpc", {
    method: "POST",
    body: JSON.stringify(body),
  });
afterEach(() => vi.unstubAllGlobals());
it.each<EvmNetwork>(["sepolia", "arc-testnet", "base-sepolia", "arbitrum-sepolia"])("keeps %s reads on the selected network", async (network) => {
  const result = { jsonrpc: "2.0", id: 7, result: "0x1" };
  const fetch = vi.fn().mockResolvedValue(Response.json(result));
  vi.stubGlobal("fetch", fetch);
  expect(evmReadTransport(network)({}).value).toMatchObject({ url: `/api/evm/${network}/rpc` });
  expect(await (await POST(request(), context(network))).json()).toEqual(result);
  expect(fetch.mock.calls[0][0]).toBe(evmRpcUrls(network)[0]);
});
it.each<EvmNetwork>(["arc-testnet", "base-sepolia"])("forwards the exact call after a failed %s upstream", async (network) => {
  const result = { jsonrpc: "2.0", id: 7, result: `0x${"0".repeat(63)}1` };
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("Failed to fetch"))
    .mockResolvedValueOnce(Response.json(result));
  vi.stubGlobal("fetch", fetch);
  const response = await POST(request(), context(network));
  expect(await response.json()).toEqual(result);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch).toHaveBeenNthCalledWith(
    2,
    evmRpcUrls(network)[1],
    expect.objectContaining({ body: JSON.stringify(payload) }),
  );
});
it.each([
  { status: 429 },
  { status: 503 },
  { code: -32002, message: "Resource unavailable" },
  { code: -32005, message: "Rate limit exceeded" },
])("recovers a Base read after an upstream availability failure (%j)", async (failure) => {
  const result = { jsonrpc: "2.0", id: 7, result: "0x" };
  const fetch = vi.fn()
    .mockResolvedValueOnce("status" in failure
      ? new Response(null, { status: failure.status })
      : Response.json({ jsonrpc: "2.0", id: 7, error: failure }))
    .mockResolvedValueOnce(Response.json(result));
  vi.stubGlobal("fetch", fetch);
  expect(await (await POST(request(), context("base-sepolia"))).json()).toEqual(result);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[1][0]).not.toBe(fetch.mock.calls[0][0]);
});
it.each([
  { code: 3, message: "execution reverted", data: "0x12345678" },
  { code: -32000, message: "execution reverted", data: "0x12345678" },
  { code: -32602, message: "Invalid params" },
])("preserves contract and request errors without retry (%j)", async (error) => {
  const result = {
    jsonrpc: "2.0",
    id: 7,
    error,
  };
  const fetch = vi.fn().mockResolvedValue(Response.json(result));
  vi.stubGlobal("fetch", fetch);
  expect(await (await post(request())).json()).toEqual(result);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("rejects broadcasts and malformed or oversized requests without network calls", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  for (const body of [
    null,
    [],
    { ...payload, method: "eth_sendRawTransaction" },
    { ...payload, params: {} },
  ]) {
    expect((await post(request(body))).status).toBe(400);
  }
  expect(
    (await post(request({ ...payload, params: ["x".repeat(32768)] }))).status,
  ).toBe(413);
  expect(fetch).not.toHaveBeenCalled();
});
it("returns a bounded outage response when every RPC fails", async () => {
  const fetch = vi
    .fn()
    .mockImplementation(async () => new Response(null, { status: 503 }));
  vi.stubGlobal("fetch", fetch);
  const response = await post(request());
  expect(response.status).toBe(502);
  expect(await response.json()).toMatchObject({
    id: 7,
    error: { code: -32002 },
  });
  expect(fetch).toHaveBeenCalledTimes(evmRpcUrls("arc-testnet").length);
});

it("rejects unconfigured networks before making upstream calls", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect((await POST(request(), context("mainnet"))).status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
});
it("retries malformed upstream responses and mismatched request IDs", async () => {
  const result = { jsonrpc: "2.0", id: 7, result: null };
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json({ result: "unverified" }))
    .mockResolvedValueOnce(Response.json({ ...result, id: 99 }))
    .mockResolvedValueOnce(Response.json(result));
  vi.stubGlobal("fetch", fetch);
  expect(await (await post(request())).json()).toEqual(result);
  expect(fetch).toHaveBeenCalledTimes(3);
});
