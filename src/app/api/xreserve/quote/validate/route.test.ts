import * as configs from "../../../../../config/bridge-config";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST } from "./route";
import { currentBridgeConfig } from "../../../../../config/bridge-config";
import fixture from "../../../../../bridge/providers/xreserve/fixtures/cctp-hook.json";

const input = { recovery: currentBridgeConfig("testnet"),
  network: "sepolia", amount: "100", sender: fixture.sender, recipient: fixture.recipient,
  signedQuote: "0x01020304", fee: "26569",
};
// Relevant validation fields returned by Circle on 2026-10-22. The source token
// is adapted to Sepolia, and the opaque signed payload is a placeholder.
const validation = {
  signedQuote: input.signedQuote, feeTotalAmount: "26569",
  feeToken: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", nonce: "0",
  expiry: { mode: "BLOCK_NUMBER", expiresAtBlock: 26247523, blockEstimatedAt: 1792664514,
    secondsRemaining: 144, expired: false },
  claimable: true, failedChecks: [],
  items: [{ type: "FORWARD", argsMatch: true }, { type: "PRE_FINALITY", argsMatch: true }],
};
const request = (body: unknown = input) => new Request("http://localhost/api/xreserve/quote/validate", {
  method: "POST", body: JSON.stringify(body),
});
beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("validates the exact configured burn with Circle rather than trusting client call arguments or clocks", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json(validation));
  vi.stubGlobal("fetch", fetch);
  const response = await POST(request({ ...input, abiSignature: "malicious()", args: ["untrusted"], expiresAt: 0 }));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ claimable: true, secondsRemaining: 144 });
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0][0]).toBe("https://iris-api-sandbox.circle.com/v2/quote/validate/usdc/0");
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
    abiSignature: "depositForBurnWithHookAndFees(uint256,uint32,bytes32,address,bytes32,bytes,(bytes,address))",
    args: ["100000000", "26", "0x000000000000000000000000EdC81040756AcCfF070c21D37b265b9D0b5Ba45e",
      "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
      "0x000000000000000000000000EdC81040756AcCfF070c21D37b265b9D0b5Ba45e",
      fixture.hook, [input.signedQuote, fixture.sender]],
  });
});

it("selects the production service and contracts for an allowlisted mainnet deployment", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ ...validation,
    feeToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" }));
  vi.stubGlobal("fetch", fetch);
  const response = await POST(request({ ...input, network: "ethereum", recovery: currentBridgeConfig("mainnet"),
    recipient: "mm1aqu8zjdwvcgkeug5a67kpwmnsyv2qgp7" }));
  expect(response.status).toBe(200);
  expect(fetch.mock.calls[0][0]).toBe("https://iris-api.circle.com/v2/quote/validate/usdc/0");
  const args = JSON.parse(fetch.mock.calls[0][1].body).args;
  expect(args.slice(0, 5)).toEqual(["100000000", "26",
    "0x000000000000000000000000Fa7be2f04F3Ad4ca969260729c6d45B5625984A7",
    "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    "0x000000000000000000000000Fa7be2f04F3Ad4ca969260729c6d45B5625984A7"]);
});

it.each([
  { expiry: { mode: "TIMESTAMP", expiresAt: 1792664514, secondsRemaining: 25, expired: false },
    claimable: true, failedChecks: [], expected: { claimable: true, secondsRemaining: 25 } },
  { expiry: { mode: "BLOCK_NUMBER", expiresAtBlock: 26247523, secondsRemaining: 0, expired: true },
    claimable: false, failedChecks: ["QUOTE_EXPIRED"], expected: { claimable: false, secondsRemaining: 0 } },
])("returns authoritative $expiry.mode status without applying a local buffer", async ({ expected, ...status }) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ...validation, ...status })));
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(expected);
});

it.each([
  { reason: "binding_mismatch", invalid: { signedQuote: "0xabcd" } },
  { reason: "binding_mismatch", invalid: { feeToken: "0x0000000000000000000000000000000000000000" } },
  { reason: "binding_mismatch", invalid: { feeTotalAmount: "26570" } },
  { reason: "unsupported_nonce", invalid: { nonce: "1" } },
  { reason: "invalid_response", invalid: { claimable: "true" } },
  { reason: "invalid_response", invalid: { expiry: { ...validation.expiry, mode: "UNKNOWN" } } },
  { reason: "invalid_response", invalid: { expiry: { ...validation.expiry, secondsRemaining: -1 } } },
  { reason: "invalid_response", invalid: { expiry: { ...validation.expiry, expiresAtBlock: "26247523" } } },
  { reason: "inconsistent_validation", invalid: { expiry: { ...validation.expiry, expired: true } } },
  { reason: "inconsistent_validation", invalid: { failedChecks: ["QUOTE_INVALID_SIGNATURE"] } },
  { reason: "invalid_response", invalid: { failedChecks: [null] } },
  { reason: "invalid_response", invalid: { items: [null, { type: "PRE_FINALITY", argsMatch: true }] } },
  { reason: "invalid_response", invalid: { items: [{ type: "FORWARD", argsMatch: "true" }, { type: "PRE_FINALITY", argsMatch: true }] } },
  { reason: "invalid_services", invalid: { items: [{ type: "FORWARD", argsMatch: false }, { type: "PRE_FINALITY", argsMatch: true }] } },
  { reason: "invalid_services", invalid: { items: [{ type: "FORWARD", argsMatch: true }, { type: "FORWARD", argsMatch: true }] } },
  { reason: "rejected_quote", invalid: { claimable: false, failedChecks: [] } },
  { reason: "rejected_quote", invalid: { claimable: false, expiry: { ...validation.expiry, expired: true, secondsRemaining: 0 },
    failedChecks: ["QUOTE_EXPIRED", "QUOTE_INVALID_SIGNATURE"] } },
])("fails closed and diagnoses $reason: $invalid", async ({ reason, invalid }) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ...validation, ...invalid })));
  const response = await POST(request());
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ error: "Circle quote validation unavailable. Please retry shortly." });
  expect(console.error).toHaveBeenCalledExactlyOnceWith("[circle] request failed", expect.objectContaining({
    operation: "validation", reason,
  }));
  const diagnostic = JSON.stringify(vi.mocked(console.error).mock.calls);
  expect(diagnostic).not.toContain(input.signedQuote);
  expect(diagnostic).not.toContain(validation.feeToken);
});

it.each([
  { network: "unsupported" },
  { network: "ethereum" },
  { recovery: "https://untrusted.example" },
  { sender: "0x1234" },
  { recipient: "mm1aqu8zjdwvcgkeug5a67kpwmnsyv2qgp7" },
  { fee: "1.1" },
  { signedQuote: "0x123" },
  { signedQuote: `0x${"ab".repeat(9000)}` },
])("rejects invalid quote input before contacting Circle: %j", async (invalid) => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect((await POST(request({ ...input, ...invalid }))).status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
  expect(console.error).not.toHaveBeenCalled();
});

it.each([
  { name: "redirect", reason: "upstream_http", result: () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } }), status: 302, cause: undefined },
  { name: "HTTP error", reason: "upstream_http", result: () => new Response("private upstream payload", { status: 503 }), status: 503, cause: undefined },
  { name: "connection failure", reason: "upstream_network", result: () => { throw new TypeError("private upstream payload"); }, status: undefined, cause: { kind: "network" } },
  { name: "request timeout", reason: "upstream_timeout", result: () => { throw new DOMException("private upstream payload", "TimeoutError"); }, status: undefined, cause: { kind: "timeout" } },
  { name: "malformed JSON", reason: "invalid_response", result: () => new Response("private upstream payload"), status: undefined, cause: { kind: "json" } },
  { name: "broken response stream", reason: "upstream_network", result: () => new Response(new ReadableStream({
    start(controller) { controller.error(new TypeError("private upstream payload")); },
  })), status: undefined, cause: { kind: "network" } },
  { name: "response body timeout", reason: "upstream_timeout", result: () => new Response(new ReadableStream({
    start(controller) { controller.error(new DOMException("private upstream payload", "AbortError")); },
  })), status: undefined, cause: { kind: "timeout" } },
])("diagnoses $name without treating it as expiry or exposing the raw cause", async ({ reason, result, status, cause }) => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(result));
  const response = await POST(request());
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ error: "Circle quote validation unavailable. Please retry shortly." });
  expect(console.error).toHaveBeenCalledExactlyOnceWith("[circle] request failed", {
    operation: "validation", reason, status, cause,
  });
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("private upstream payload");
});

it.each(["version", "contract", "faucet", "direction", "token metadata"])("rejects edited %s context before contacting Circle", async change => {
  const recovery = structuredClone(currentBridgeConfig("testnet"));
  if (change === "version") { recovery.document.version--; recovery.id = `testnet:${recovery.document.version}`; }
  if (change === "contract") recovery.document.supportedEvmChains["arc-testnet"]!.bridges.usdcx!.executor!.handler = `0x${"aa".repeat(20)}`;
  if (change === "faucet") recovery.derived.usdcxFaucetId = "0x179f749ee2329e317d96fe3ed5aaf9";
  if (change === "token metadata") recovery.derived.eth.decimals--;
  if (change === "direction") recovery.document.supportedEvmChains.sepolia!.bridges.usdcx!.depositEnabled = false;
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect((await POST(request({ ...input, recovery }))).status).toBe(409);
  expect(fetch).not.toHaveBeenCalled();
});

it("rejects a disabled release direction even when the client matches the current config", async () => {
  const recovery = structuredClone(currentBridgeConfig("testnet"));
  recovery.document.features.bridgeIn = false;
  vi.spyOn(configs, "currentBridgeConfig").mockReturnValue(recovery);
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect((await POST(request({ ...input, recovery }))).status).toBe(409);
  expect(fetch).not.toHaveBeenCalled();
});
