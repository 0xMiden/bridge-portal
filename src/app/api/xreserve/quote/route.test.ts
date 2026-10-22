import { afterEach, expect, it, vi } from "vitest";
import { POST } from "./route";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("retains quote schema diagnostics without exposing the malformed provider payload", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
    signedQuote: "private provider payload", burnAmount: "1000000", feeTotalAmount: "26569",
    feeToken: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    issuedAt: 1792663778, expiry: { mode: "BLOCK_NUMBER", expiresAtBlock: 26247476 },
  })));
  const response = await POST(new Request("http://localhost/api/xreserve/quote", {
    method: "POST", body: JSON.stringify({
      network: "sepolia", amount: "1", sender: "0x1111111111111111111111111111111111111111",
      recipient: "0x4e6fb40fd2f6a55140df2c42dfb5b7",
    }),
  }));
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ error: "Circle quote unavailable. Please retry shortly." });
  expect(log).toHaveBeenCalledExactlyOnceWith("[circle] request failed", {
    operation: "quote", reason: "invalid_response", status: undefined,
    cause: { kind: "schema", issues: [{ code: "invalid_format", path: ["signedQuote"] }] },
  });
  expect(JSON.stringify(log.mock.calls)).not.toContain("private provider payload");
});
