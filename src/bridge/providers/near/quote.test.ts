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

it.each([
  ["receive", bitcoinQuotes.receive.prepared, "mainnet:near-bitcoin-btc-to-miden-wbtc", "0.00098248"],
  ["send", bitcoinQuotes.send.prepared, "mainnet:near-miden-wbtc-to-bitcoin-btc", "0.00097848"],
] as const)("verifies real executable Bitcoin %s terms with the official signature verifier", (mode, fixture, routeId, received) => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(fixture.timestamp));
  const input = nearInputSchema.parse({ routeId, mode, amount: "0.001",
    midenAccount: mode === "receive" ? fixture.quoteRequest.recipient : fixture.quoteRequest.refundTo,
    externalAddress: mode === "send" ? fixture.quoteRequest.recipient : fixture.quoteRequest.refundTo });
  const verified = verifyNearQuote(fixture, input, false);
  expect(nearQuoteResult(verified, routeId).received).toBe(received);
  const changed = structuredClone(fixture);
  changed.quote.depositAddress = "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy";
  expect(() => verifyNearQuote(changed, input, false)).toThrow(/signature/);
  expect(() => verifyNearQuote(fixture, { ...input, externalAddress: "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy" }, false)).toThrow(/match/);
  if (mode === "receive") {
    // Tracking after review expiry retains the original signed terms.
    vi.advanceTimersByTime(11 * 60_000);
    expect(() => verifyNearQuote(fixture, input, false)).toThrow(/expired/);
    expect(verifyNearQuote(fixture, input, false, false)).toEqual(verified);
  }
});

it.each([
  ["receive", bitcoinQuotes.receive.legacy, "mainnet:near-bitcoin-btc-to-miden-wbtc"],
  ["send", bitcoinQuotes.send.legacy, "mainnet:near-miden-wbtc-to-bitcoin-btc"],
] as const)("recovers signed legacy Bitcoin %s terms without rewriting or reusing them for a new transfer", (mode, fixture, routeId) => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(fixture.timestamp));
  const input = nearInputSchema.parse({ routeId, mode, amount: "0.001",
    midenAccount: mode === "receive" ? fixture.quoteRequest.recipient : fixture.quoteRequest.refundTo,
    externalAddress: mode === "send" ? fixture.quoteRequest.recipient : fixture.quoteRequest.refundTo });
  // Even an unexpired old quote cannot be used to start a new transfer.
  expect(() => verifyNearQuote(fixture, input, false)).toThrow(/match/);
  vi.advanceTimersByTime(7 * 86_400_000);
  const recovered = verifyNearQuote(fixture, input, false, false);
  expect(recovered).toEqual(fixture);
  const rewritten = structuredClone(fixture);
  rewritten.quoteRequest[mode === "send" ? "originAsset" : "destinationAsset"] = "1cs_v1:miden:ft:0x3084d3c389ececd15fda9770d18c8a";
  expect(() => verifyNearQuote(rewritten, input, false, false)).toThrow(/signature/);
});
