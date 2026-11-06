import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST as preview } from "./quote/route";
import { POST as prepare } from "./prepare/route";
import { POST as status } from "./status/route";
import { POST as deposit } from "./deposit/submit/route";
import { nearTestInput, nearReceiveInput, signedNearQuote, nearStatus, nearTxHash, nearDestinationHash } from "../../../../test/near-quotes";
import { verifyQuoteSignature } from "@defuse-protocol/one-click-sdk-typescript";

vi.mock("@defuse-protocol/one-click-sdk-typescript", async importOriginal => {
  const actual = await importOriginal<typeof import("@defuse-protocol/one-click-sdk-typescript")>();
  return { ...actual, verifyQuoteSignature: (response: Parameters<typeof actual.verifyQuoteSignature>[0]) => actual.verifyQuoteSignature(response, managerKey) };
});
import { testManagerKey as managerKey } from "../../../../test/near-quotes";
const fetcher = vi.fn<typeof fetch>();
const request = (body: unknown) => new Request("https://portal.example/api/near/quote", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => { vi.stubGlobal("fetch", fetcher); fetcher.mockReset(); vi.stubEnv("NEAR_TRANSFERS_ENABLED", "true"); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

it("pins exact input, source decimals and chain direction while keeping the API credential server-side", async () => {
  vi.stubEnv("NEAR_API_KEY", "private-partner-key");
  fetcher.mockImplementation(async (_url, init) => {
    const body = JSON.parse(init!.body as string);
    expect(body).toMatchObject({ dry: true, amount: "5000000", depositType: "ORIGIN_CHAIN", recipientType: "DESTINATION_CHAIN",
      refundTo: nearTestInput.midenAccount, confidentiality: "basic", swapType: "EXACT_INPUT", quoteWaitingTimeMs: 0 });
    const response = signedNearQuote(nearTestInput, true);
    // The request deadline must match exactly, including millisecond precision.
    vi.setSystemTime(new Date(Date.parse(body.deadline) - 600_000));
    return Response.json(signedNearQuote(nearTestInput, true, response.quote));
  });
  vi.useFakeTimers();
  const response = await preview(request(nearTestInput));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.text()).not.toContain("private-partner-key");
  expect(fetcher.mock.calls[0]).toMatchObject(["https://1click.chaindefuser.com/v0/quote", { cache: "no-store", redirect: "error", headers: { Authorization: "Bearer private-partner-key" } }]);
  vi.useRealTimers();
});

it.each([
  { mode: "receive" }, { routeId: "mainnet:near-miden-usdcx-to-arc-usdc" }, { amount: "5.0000001" },
  { amount: "1e6" }, { amount: "0" }, { midenAccount: "mtst1wrongnetwork" }, { evmAddress: "0x0" },
  { midenAccount: `${nearTestInput.midenAccount.split("_")[0]}_qqqqqq` },
  { originAsset: "arbitrary" }, { upstream: "https://attacker.example" },
])("rejects invalid portal requests before upstream I/O: %j", async patch => {
  expect((await preview(request({ ...nearTestInput, ...patch }))).status).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([
  ["mainnet:near-miden-eth-to-base-eth", "0.00000001", "1"],
  ["mainnet:near-miden-wbtc-to-base-cbbtc", "0.00000001", "1"],
  ["mainnet:near-miden-usdt-to-arbitrum-usdt0", "0.000001", "1"],
])("uses source precision for %s and imposes no $5 minimum", async (routeId, amount, expected) => {
  vi.useFakeTimers();
  const input = { ...nearTestInput, routeId, amount };
  fetcher.mockResolvedValueOnce(Response.json(signedNearQuote(input, true)));
  expect((await preview(request(input))).status).toBe(200);
  expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string).amount).toBe(expected);
});

it.each([
  ["mainnet:near-ethereum-eth-to-miden-eth", "0.003000000000000001", "3000000000000001", "nep141:eth.omft.near", "nep141:miden-0x419f8f4bff72959132aa7cea15a4c1.omft.near"],
  ["mainnet:near-base-cbbtc-to-miden-wbtc", "0.0001", "10000", "nep141:base-0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf.omft.near", "nep141:miden-0x3084d3c389ececd15fda9770d18c8a.omft.near"],
  ["mainnet:near-arbitrum-usdt0-to-miden-usdt", "5", "5000000", "nep141:arb-0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9.omft.near", "nep141:miden-0x5cb79d29507d3ad17bb6dc60279e89.omft.near"],
])("quotes %s with EVM source precision, Miden delivery and EVM refunds", async (routeId, amount, units, originAsset, destinationAsset) => {
  vi.useFakeTimers();
  const input = { ...nearReceiveInput, routeId, amount };
  fetcher.mockResolvedValueOnce(Response.json(signedNearQuote(input, true)));
  expect((await preview(request(input))).status).toBe(200);
  expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toMatchObject({
    amount: units, originAsset, destinationAsset, refundTo: input.evmAddress, recipient: input.midenAccount,
    depositType: "ORIGIN_CHAIN", recipientType: "DESTINATION_CHAIN", refundType: "ORIGIN_CHAIN", confidentiality: "basic",
  });
});

it("rejects a signed Miden deposit address for an EVM-funded quote", async () => {
  vi.useFakeTimers();
  fetcher.mockResolvedValueOnce(Response.json(signedNearQuote(nearReceiveInput, false, { depositAddress: nearReceiveInput.midenAccount })));
  expect((await prepare(request(nearReceiveInput))).status).toBe(502);
});

it.each([nearTestInput, nearReceiveInput])("prepares once for $mode; pause still permits tracking and notification", async input => {
  vi.useFakeTimers();
  const prepared = signedNearQuote(input);
  fetcher.mockResolvedValueOnce(Response.json(prepared));
  expect((await prepare(request(input))).status).toBe(200);
  expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string).dry).toBe(false);
  expect((await prepare(request({ ...input, quote: prepared }))).status).toBe(200);
  // An already-open review keeps its original signed wait policy after an update.
  const legacy = signedNearQuote(input, false, {}, 10_000);
  expect((await prepare(request({ ...input, quote: legacy }))).status).toBe(200);
  expect(fetcher).toHaveBeenCalledTimes(1);
  vi.stubEnv("NEAR_TRANSFERS_ENABLED", "false");
  expect((await prepare(request({ ...input, quote: prepared }))).status).toBe(503);
  vi.advanceTimersByTime(700_000);
  fetcher.mockResolvedValueOnce(Response.json(nearStatus(prepared)));
  expect((await status(request({ routeId: input.routeId, quote: prepared }))).status).toBe(200);
  fetcher.mockResolvedValueOnce(Response.json(nearStatus(prepared, "KNOWN_DEPOSIT_TX")));
  expect((await deposit(request({ routeId: input.routeId, quote: prepared, txHash: nearTxHash }))).status).toBe(200);
  vi.useRealTimers();
});

it("sanitizes authorization errors and preserves the service correlation ID", async () => {
  fetcher.mockResolvedValueOnce(Response.json({ correlationId: "near-reference-123", message: "secret Bearer credential", statusCode: 401 }, { status: 401 }));
  const response = await prepare(request(nearTestInput));
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ correlationId: "near-reference-123", error: "NEAR could not authorize this quote. Contact support with the reference." });
});

it.each(["PENDING_DEPOSIT", "SUCCESS"] as const)("tracks %s when status omits quote metadata and returns null amounts or refund reasons", async state => {
  const input = state === "PENDING_DEPOSIT" ? nearReceiveInput : nearTestInput;
  const original = signedNearQuote(input, false, {}, 10_000);
  const payload = { ...nearStatus(structuredClone(original), state), swapDetails: {
    originChainTxHashes: [{ hash: nearTxHash }], destinationChainTxHashes: [{ hash: nearDestinationHash }],
    amountOut: state === "PENDING_DEPOSIT" ? null : "4980000", refundedAmount: "0", refundReason: null,
  } };
  // The live status endpoint omits these original quote fields. Its signature
  // still covers the original quoteWaitingTimeMs, so verifying it as-is fails.
  Reflect.deleteProperty(payload.quoteResponse, "correlationId");
  Reflect.deleteProperty(payload.quoteResponse.quoteRequest, "quoteWaitingTimeMs");
  fetcher.mockResolvedValueOnce(Response.json(payload));
  const response = await status(request({ routeId: input.routeId, quote: original }));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body).toMatchObject({ status: state, quoteResponse: {
    correlationId: original.correlationId, signature: original.signature,
    quoteRequest: { quoteWaitingTimeMs: 10_000 },
  }, swapDetails: { originChainTxHashes: [{ hash: nearTxHash }], destinationChainTxHashes: [{ hash: nearDestinationHash }] } });
  expect(body.swapDetails.amountOut).toBe(state === "PENDING_DEPOSIT" ? undefined : "4980000");
  expect(body.swapDetails.refundReason).toBeUndefined();
  expect(verifyQuoteSignature(body.quoteResponse)).toBe(true);
});

it.each(["recipient", "amountOut", "depositAddress", "quoteWaitingTimeMs", "signature"])("rejects changed %s while restoring omitted status metadata", async field => {
  const original = signedNearQuote();
  const payload = nearStatus(structuredClone(original), "SUCCESS");
  Reflect.deleteProperty(payload.quoteResponse, "correlationId");
  Reflect.deleteProperty(payload.quoteResponse.quoteRequest, "quoteWaitingTimeMs");
  if (field === "recipient") payload.quoteResponse.quoteRequest.recipient = "0x2222222222222222222222222222222222222222";
  if (field === "amountOut") payload.quoteResponse.quote.amountOut = "9999999";
  if (field === "depositAddress") payload.quoteResponse.quote.depositAddress = nearTestInput.midenAccount;
  if (field === "quoteWaitingTimeMs") payload.quoteResponse.quoteRequest.quoteWaitingTimeMs = 5_000;
  if (field === "signature") payload.quoteResponse.signature = "ed25519:invalid";
  fetcher.mockResolvedValueOnce(Response.json(payload));
  expect((await status(request({ routeId: nearTestInput.routeId, quote: original }))).status).toBe(502);
});

it("never relays a mismatched status or invalid signature as delivery", async () => {
  const original = signedNearQuote();
  const another = signedNearQuote(nearTestInput, false, { depositAddress: nearTestInput.midenAccount });
  fetcher.mockResolvedValueOnce(Response.json(nearStatus(another, "SUCCESS")));
  expect((await status(request({ routeId: nearTestInput.routeId, quote: original }))).status).toBe(502);
  original.quote.depositAddress = nearTestInput.midenAccount;
  expect((await status(request({ routeId: nearTestInput.routeId, quote: original }))).status).toBe(400);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
