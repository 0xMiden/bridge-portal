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
const alchemy = "https://eth-mainnet.g.alchemy.com/v2/test-key";
const privateNetworks = [
  ["ethereum", "ETHEREUM_RPC_URL", "eth-mainnet", "0x1"],
  ["arc", "ARC_MAINNET_RPC_URL", "arc-mainnet", "0x13b2"],
  ["base", "BASE_RPC_URL", "base-mainnet", "0x2105"],
  ["arbitrum", "ARBITRUM_RPC_URL", "arb-mainnet", "0xa4b1"],
  ["sepolia", "AGGLAYER_SEPOLIA_RPC_URL", "eth-sepolia", "0xaa36a7"],
  ["arc-testnet", "ARC_TESTNET_RPC_URL", "arc-testnet", "0x4cef52"],
  ["base-sepolia", "BASE_SEPOLIA_RPC_URL", "base-sepolia", "0x14a34"],
  ["arbitrum-sepolia", "ARBITRUM_SEPOLIA_RPC_URL", "arb-sepolia", "0x66eee"],
] as const;
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it.each(privateNetworks)("uses private Alchemy for %s and recovers through that network's public fallback", async (network, env, host, chainId) => {
  vi.stubEnv(env, "");
  const publicFallback = evmRpcUrls(network)[0];
  const url = `https://${host}.g.alchemy.com/v2/test-key`;
  vi.stubEnv(env, ` ${url} `);
  const result = { jsonrpc: "2.0", id: 7, result: chainId };
  const fetch = vi.fn().mockResolvedValue(Response.json(result));
  vi.stubGlobal("fetch", fetch);
  const body = { ...payload, method: "eth_chainId", params: [] };
  const response = await POST(request(body), context(network));
  expect(await response.json()).toEqual(result);
  expect(fetch).toHaveBeenCalledExactlyOnceWith(url, expect.objectContaining({ body: JSON.stringify(body) }));
  expect(evmReadTransport(network)({}).value).toMatchObject({ url: `/api/evm/${network}/rpc` });

  fetch.mockReset().mockResolvedValueOnce(new Response(null, { status: 403 }))
    .mockResolvedValueOnce(Response.json(result));
  expect(await (await POST(request(body), context(network))).json()).toEqual(result);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[0][0]).toBe(url);
  expect(fetch.mock.calls[1][0]).toBe(publicFallback);
});
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
it.each((["base-sepolia", "ethereum"] as const).flatMap(network => [
  { status: 401 },
  { status: 429 },
  { status: 503 },
  { code: -32002, message: "Resource unavailable" },
  { code: -32005, message: "Rate limit exceeded" },
].map(failure => ({ network, failure }))))("recovers a $network read after an upstream availability failure ($failure)", async ({ network, failure }) => {
  vi.stubEnv("ETHEREUM_RPC_URL", alchemy);
  vi.stubEnv("BASE_SEPOLIA_RPC_URL", "");
  const result = { jsonrpc: "2.0", id: 7, result: "0x" };
  const fetch = vi.fn()
    .mockResolvedValueOnce("status" in failure
      ? new Response(null, { status: failure.status })
      : Response.json({ jsonrpc: "2.0", id: 7, error: failure }))
    .mockResolvedValueOnce(Response.json(result));
  vi.stubGlobal("fetch", fetch);
  expect(await (await POST(request(), context(network))).json()).toEqual(result);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[1][0]).not.toBe(fetch.mock.calls[0][0]);
  if (network === "ethereum") {
    expect(fetch.mock.calls[0][0]).toBe(alchemy);
    expect(fetch.mock.calls[1][0]).toBe("https://ethereum-rpc.publicnode.com");
  }
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
it("serves Ethereum reads when PublicNode is unavailable and Merkle is rate-limited", async () => {
  vi.stubEnv("ETHEREUM_RPC_URL", "");
  const result = { jsonrpc: "2.0", id: 7, result: "0x1" };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === "https://ethereum-rpc.publicnode.com") return new Response(null, { status: 503 });
    if (url === "https://eth.merkle.io") return new Response(null, { status: 429 });
    if (url === "https://eth.drpc.org") return Response.json(result);
    throw new Error(`Unexpected RPC: ${url}`);
  }));
  const response = await POST(request({ ...payload, method: "eth_chainId", params: [] }), context("ethereum"));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(result);
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
it("returns an outage before the browser times out when private and public RPCs all hang", async () => {
  vi.stubEnv("ARC_TESTNET_RPC_URL", "https://arc-testnet.g.alchemy.com/v2/test-key");
  vi.useFakeTimers();
  // Node's native AbortSignal timer is outside Vitest's clock; model that API's
  // cancellation with the controlled clock while exercising the real fallback loop.
  const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation((delay) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), delay);
    return controller.signal;
  });
  try {
    const fetch = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
    }));
    vi.stubGlobal("fetch", fetch);
    let response: Response | undefined;
    const pending = post(request()).then((result) => { response = result; });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(response?.status).toBe(502);
    await pending;
    expect(await response!.json()).toMatchObject({ id: 7, error: { code: -32002 } });
    expect(fetch).toHaveBeenCalledTimes(evmRpcUrls("arc-testnet").length);
  } finally {
    vi.clearAllTimers();
    timeout.mockRestore();
    vi.useRealTimers();
  }
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
