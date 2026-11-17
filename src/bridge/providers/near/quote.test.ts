import { afterEach, expect, it, vi } from "vitest";
import signedPreview from "./fixtures/signed-preview.json";
import bitcoinQuotes from "../../../../test/fixtures/near-bitcoin.json";
import { nearInputSchema } from "./schema";
import { nearQuoteResult, nearRequest, verifyNearQuote } from "./quote";

// Real service signature over a dry quote requested with test accounts.
const input = nearInputSchema.parse({ routeId: "mainnet:near-miden-eth-to-ethereum-eth", mode: "send", amount: "0.002",
  midenAccount: signedPreview.quoteRequest.refundTo, externalAddress: signedPreview.quoteRequest.recipient });
afterEach(() => { vi.useRealTimers(); });

it("verifies a real 1Click signature and derives output/minimum with integer token units", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(signedPreview.timestamp));
  const response = verifyNearQuote(signedPreview, input, true);
  expect(nearQuoteResult(response, input.routeId)).toMatchObject({ received: "0.001959990508755621",
    minimumReceived: "0.001940390603668064", estimatedSeconds: 32 });
  expect(nearRequest(input, true, signedPreview.quoteRequest.deadline).amount).toBe("200000");
});

it("rejects tampered signed terms, mismatched accounts/routes and an expired preview", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(signedPreview.timestamp));
  for (const patch of [ { amount: "6" }, { externalAddress: "0x2222222222222222222222222222222222222222" },
    { routeId: "mainnet:near-miden-eth-to-base-eth" }, { midenAccount: "mm1apu8zjdwvcgkeug5a67kpwmnsynr09mq_qr7qqq9wr6w" } ]) {
    expect(() => verifyNearQuote(signedPreview, { ...input, ...patch }, true)).toThrow();
  }
  const changed = structuredClone(signedPreview); changed.quote.amountOut = "9999999";
  expect(() => verifyNearQuote(changed, input, true)).toThrow(/signature/);
  vi.advanceTimersByTime(60_001);
  expect(() => verifyNearQuote(signedPreview, input, true)).toThrow(/expired/);
});

it("verifies the signed wBTC withdrawal against the reviewed Bitcoin recipient", () => {
  const fixture = bitcoinQuotes.send.prepared;
  const routeId = "mainnet:near-miden-wbtc-to-bitcoin-btc";
  vi.useFakeTimers(); vi.setSystemTime(new Date(fixture.timestamp));
  const input = nearInputSchema.parse({ routeId, mode: "send", amount: "0.001",
    midenAccount: fixture.quoteRequest.refundTo, externalAddress: fixture.quoteRequest.recipient });
  const verified = verifyNearQuote(fixture, input, false);
  expect(nearQuoteResult(verified, routeId).received).toBe("0.00097848");
  const changed = structuredClone(fixture);
  changed.quote.depositAddress = "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy";
  expect(() => verifyNearQuote(changed, input, false)).toThrow(/signature/);
  expect(() => verifyNearQuote(fixture, { ...input, externalAddress: "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy" }, false)).toThrow(/match/);
});
