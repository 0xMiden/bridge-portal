import { afterEach, expect, it, vi } from "vitest";
import signedPreview from "./fixtures/signed-preview.json";
import { nearInputSchema } from "./schema";
import { nearQuoteResult, nearRequest, verifyNearQuote } from "./quote";

const input = nearInputSchema.parse({ routeId: "mainnet:near-miden-usdcx-to-base-usdc", mode: "send", amount: "5",
  midenAccount: signedPreview.quoteRequest.refundTo, evmAddress: signedPreview.quoteRequest.recipient });
afterEach(() => { vi.useRealTimers(); });

it("verifies a real 1Click signature and derives output/minimum with integer token units", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(signedPreview.timestamp));
  const response = verifyNearQuote(signedPreview, input, true);
  expect(nearQuoteResult(response, input.routeId)).toMatchObject({ received: "4.986106",
    minimumReceived: "4.936244", estimatedSeconds: 27 });
  expect(nearRequest(input, true, signedPreview.quoteRequest.deadline).amount).toBe("5000000");
});

it("rejects tampered signed terms, mismatched accounts/routes and an expired preview", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(signedPreview.timestamp));
  for (const patch of [ { amount: "6" }, { evmAddress: "0x2222222222222222222222222222222222222222" },
    { routeId: "mainnet:near-miden-usdcx-to-ethereum-usdc" }, { midenAccount: "mm1aqu8zjdwvcgkeug5a67kpwmnsyv2qgp7_qr7qqq9wr6w" } ]) {
    expect(() => verifyNearQuote(signedPreview, { ...input, ...patch }, true)).toThrow();
  }
  const changed = structuredClone(signedPreview); changed.quote.amountOut = "9999999";
  expect(() => verifyNearQuote(changed, input, true)).toThrow(/signature/);
  vi.advanceTimersByTime(60_001);
  expect(() => verifyNearQuote(signedPreview, input, true)).toThrow(/expired/);
});
