import { afterEach, expect, it, vi } from "vitest";
import { POST } from "./route";
import { currentDeployment } from "../../../../../config/deployments";
import fixture from "../../../../../bridge/providers/xreserve/fixtures/cctp-hook.json";

const input = {
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
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("validates the exact configured burn with Circle rather than trusting client call arguments or clocks", async () => {
  vi.spyOn(Date, "now").mockReturnValue(1792664514_000 + 86_400_000);
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
  const response = await POST(request({ ...input, network: "ethereum", deploymentId: currentDeployment("mainnet").id,
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
  { signedQuote: "0xabcd" },
  { feeToken: "0x0000000000000000000000000000000000000000" },
  { feeTotalAmount: "26570" },
  { nonce: "1" },
  { expiry: { ...validation.expiry, mode: "UNKNOWN" } },
  { expiry: { ...validation.expiry, secondsRemaining: -1 } },
  { expiry: { ...validation.expiry, expiresAtBlock: "26247523" } },
  { expiry: { ...validation.expiry, expired: true } },
  { failedChecks: ["QUOTE_INVALID_SIGNATURE"] },
  { items: [{ type: "FORWARD", argsMatch: false }, { type: "PRE_FINALITY", argsMatch: true }] },
  { items: [{ type: "FORWARD", argsMatch: true }, { type: "FORWARD", argsMatch: true }] },
  { claimable: false, failedChecks: [] },
  { claimable: false, expiry: { ...validation.expiry, expired: true, secondsRemaining: 0 },
    failedChecks: ["QUOTE_EXPIRED", "QUOTE_INVALID_SIGNATURE"] },
])("fails closed for invalid or mismatched validation: %j", async (invalid) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ...validation, ...invalid })));
  const response = await POST(request());
  expect(response.status).toBe(502);
  expect(await response.json()).not.toHaveProperty("claimable");
});

it.each([
  { network: "unsupported" },
  { network: "ethereum" },
  { deploymentId: "https://untrusted.example" },
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
});

it("does not treat a validation outage as an expired quote", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Unavailable", { status: 503 })));
  const response = await POST(request());
  expect(response.status).toBe(502);
  expect(await response.json()).not.toHaveProperty("claimable");
});
