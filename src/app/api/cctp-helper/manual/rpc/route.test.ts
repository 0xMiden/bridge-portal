import { afterEach, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("server-only", () => ({}));
vi.mock("../../../../../config/cctp-helper.server", () => ({ helperServer: () => ({
  deployment: { deploymentId: "privacy-fixture" }, server: { solanaRpc: "https://private-rpc.invalid/key-sentinel" },
}) }));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const payload = { jsonrpc: "2.0", id: 7, method: "getSlot", params: [{ commitment: "finalized" }] };
const request = (body: unknown = payload) => new Request("http://localhost/api/cctp-helper/manual/rpc?deploymentId=privacy-fixture", {
  method: "POST", body: JSON.stringify(body),
});
it("removes private provider error text, data, causes and extras", async () => {
  const sentinel = "https://private-rpc.invalid/key-sentinel";
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ jsonrpc: "2.0", id: 7, endpoint: sentinel,
    error: { code: -32000, message: `Request to ${sentinel} failed`, data: { cause: sentinel }, cause: sentinel } })));
  const log = vi.spyOn(console, "error");
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ jsonrpc: "2.0", id: 7, error: { code: -32000, message: "Source RPC request failed." } });
  expect(log).not.toHaveBeenCalled();
});
it.each([105, null, { value: ["chain-result"] }])("retains successful results without provider envelope extras %#", async result => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ jsonrpc: "2.0", id: 7, result, endpoint: "key-sentinel" })));
  expect(await (await POST(request())).json()).toEqual({ jsonrpc: "2.0", id: 7, result });
});
it.each([
  { jsonrpc: "2.0", id: 8, result: 105 }, { id: 7, result: 105 },
  { jsonrpc: "2.0", id: 7, result: 105, error: { code: -32000 } },
  { jsonrpc: "2.0", id: 7, error: { code: "key-sentinel" } },
])("rejects mismatched or malformed upstream envelopes %#", async upstream => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(upstream)));
  const response = await POST(request());
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ reason: "route_unavailable" });
});
it("retains the allowlisted request boundary before contacting a private provider", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const response = await POST(request({ ...payload, method: "caller-selected-rpc" }));
  expect(response.status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
});
