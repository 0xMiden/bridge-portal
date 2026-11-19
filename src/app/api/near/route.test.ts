import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { http } from "msw";
import { setupServer } from "msw/node";
import { POST as preview } from "./quote/route";
import { POST as prepare } from "./prepare/route";
import { POST as status } from "./status/route";
import { POST as deposit } from "./deposit/submit/route";
import { nearTestInput, nearReceiveInput, bitcoinReceiveInput, nearQuoteFixture, nearStatus, nearTxHash, nearDestinationHash } from "../../../../test/near-quotes";
import { verifyQuoteSignature } from "@defuse-protocol/one-click-sdk-typescript";
import * as configs from "../../../config/bridge-config";
import { nearConfig } from "../../../config/near/config";
import bitcoinQuotes from "../../../../test/fixtures/near-bitcoin.json";
import { nearQuoteSchema } from "../../../bridge/providers/near/schema";

vi.mock("@defuse-protocol/one-click-sdk-typescript", async importOriginal => {
  const actual = await importOriginal<typeof import("@defuse-protocol/one-click-sdk-typescript")>();
  return { ...actual, verifyQuoteSignature: vi.fn(() => true) };
});
const fetcher = vi.fn<typeof fetch>();
const server = setupServer(http.all("https://1click.chaindefuser.com/v0/*", ({ request }) => fetcher(request)));
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
const request = (body: unknown, signal?: AbortSignal) => new Request("https://portal.example/api/near/quote", { method: "POST", body: JSON.stringify(body), signal });
const outgoing = (input: RequestInfo | URL, init?: RequestInit) => new Request(input instanceof Request ? input.clone() : input, init);
beforeEach(() => { fetcher.mockReset(); vi.mocked(verifyQuoteSignature).mockReturnValue(true); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.useRealTimers(); });

it.each([
  ["usdcx", "usdc", "nep141:pol-0x3c499c542cef5e3811e1192ce70d8cc03d5c3359.omdep.near", "nep245:v2_1.omni.hot.tg:137_qiStmoQJDQPTebaPjgx5VBxZv6L"],
  ["usdt", "usdt", "nep141:pol-0xc2132d05d31c914a87c6611c10748aeb04b58e8f.omdep.near", "nep245:v2_1.omni.hot.tg:137_3hpYoaLtt8MP1Z2GH1U473DMRKgr"],
])("uses the current Polygon %s asset in either direction and tracks its retired pin", async (miden, token, active, retired) => {
  vi.useFakeTimers();
  for (const mode of ["send", "receive"] as const) {
    const routeId = mode === "send" ? `mainnet:near-miden-${miden}-to-polygon-${token}` : `mainnet:near-polygon-${token}-to-miden-${miden}`;
    const input = { ...nearTestInput, mode, routeId };
    const field = mode === "send" ? "destinationAsset" : "originAsset";
    fetcher.mockResolvedValueOnce(Response.json(nearQuoteFixture(input, true)));
    expect((await preview(request(input))).status).toBe(200);
    expect((await outgoing(...fetcher.mock.lastCall!).json())[field]).toBe(active);
    const old = nearQuoteFixture(input);
    old.quoteRequest[field] = retired;
    expect((await prepare(request({ ...input, quote: old }))).status).toBe(400);
    fetcher.mockResolvedValueOnce(Response.json(nearStatus(old)));
    expect((await status(request({ routeId, quote: old }))).status).toBe(200);
  }
});

it("recovers a signed receipt and its notification after the route leaves the active catalog", async () => {
  const routeId = bitcoinReceiveInput.routeId;
  const quote = nearQuoteSchema.parse(bitcoinQuotes.receive.prepared);
  const actual = await vi.importActual<typeof import("@defuse-protocol/one-click-sdk-typescript")>("@defuse-protocol/one-click-sdk-typescript");
  vi.mocked(verifyQuoteSignature).mockImplementation(actual.verifyQuoteSignature);
  const routes = nearConfig.routes;
  nearConfig.routes = routes.filter(pair => pair.receiveId !== routeId);
  try {
    expect((await prepare(request(bitcoinReceiveInput))).status).toBe(400);
    fetcher.mockImplementation(async () => Response.json(nearStatus(quote)));
    expect((await status(request({ routeId, quote }))).status).toBe(200);
    expect((await deposit(request({ routeId, quote, txHash: "ab".repeat(32) }))).status).toBe(200);
    expect((await status(request({ routeId: nearReceiveInput.routeId, quote }))).status).toBe(400);
    expect(fetcher).toHaveBeenCalledTimes(2);
  } finally { nearConfig.routes = routes; }
});

it("pins exact input, source decimals and chain direction while keeping the API credential server-side", async () => {
  vi.stubEnv("NEAR_API_KEY", "private-partner-key");
  fetcher.mockImplementation(async (input, init) => {
    const body = await outgoing(input, init).json();
    expect(body).toMatchObject({ dry: true, amount: "5000000", depositType: "ORIGIN_CHAIN", recipientType: "DESTINATION_CHAIN",
      refundTo: nearTestInput.midenAccount, confidentiality: "basic", swapType: "EXACT_INPUT", quoteWaitingTimeMs: 0 });
    const response = nearQuoteFixture(nearTestInput, true);
    // The request deadline must match exactly, including millisecond precision.
    vi.setSystemTime(new Date(Date.parse(body.deadline) - 600_000));
    return Response.json(nearQuoteFixture(nearTestInput, true, response.quote));
  });
  vi.useFakeTimers();
  const { externalAddress, ...legacyInput } = nearTestInput;
  const response = await preview(request({ ...legacyInput, evmAddress: externalAddress }));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.text()).not.toContain("private-partner-key");
  const sent = outgoing(...fetcher.mock.calls[0]);
  expect(sent).toMatchObject({ url: "https://1click.chaindefuser.com/v0/quote", method: "POST" });
  expect(sent.headers.get("authorization")).toBe("Bearer private-partner-key");
  vi.useRealTimers();
});

it.each([
  { mode: "receive" }, { routeId: "mainnet:near-miden-usdcx-to-arc-usdc" }, { amount: "5.0000001" },
  { amount: "1e6" }, { amount: "0" }, { midenAccount: "mtst1wrongnetwork" }, { externalAddress: "0x0" },
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
  fetcher.mockResolvedValueOnce(Response.json(nearQuoteFixture(input, true)));
  expect((await preview(request(input))).status).toBe(200);
  expect((await outgoing(...fetcher.mock.calls[0]).json()).amount).toBe(expected);
});

it.each([
  ["mainnet:near-ethereum-eth-to-miden-eth", "0.003000000000000001", "3000000000000001", "nep141:eth.omft.near", "nep141:miden-0x419f8f4bff72959132aa7cea15a4c1.omft.near"],
  ["mainnet:near-base-cbbtc-to-miden-wbtc", "0.0001", "10000", "nep141:base-0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf.omft.near", "nep141:miden-0x3084d3c389ececd15fda9770d18c8a.omft.near"],
  ["mainnet:near-arbitrum-usdt0-to-miden-usdt", "5", "5000000", "nep141:arb-0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9.omft.near", "nep141:miden-0x5cb79d29507d3ad17bb6dc60279e89.omft.near"],
])("quotes %s with EVM source precision, Miden delivery and EVM refunds", async (routeId, amount, units, originAsset, destinationAsset) => {
  vi.useFakeTimers();
  const input = { ...nearReceiveInput, routeId, amount };
  fetcher.mockResolvedValueOnce(Response.json(nearQuoteFixture(input, true)));
  expect((await preview(request(input))).status).toBe(200);
  expect(await outgoing(...fetcher.mock.calls[0]).json()).toMatchObject({
    amount: units, originAsset, destinationAsset, refundTo: input.externalAddress, recipient: input.midenAccount,
    depositType: "ORIGIN_CHAIN", recipientType: "DESTINATION_CHAIN", refundType: "ORIGIN_CHAIN", confidentiality: "basic",
  });
});

it("rejects a signed Miden deposit address for an EVM-funded quote", async () => {
  vi.useFakeTimers();
  fetcher.mockResolvedValueOnce(Response.json(nearQuoteFixture(nearReceiveInput, false, { depositAddress: nearReceiveInput.midenAccount })));
  expect((await prepare(request(nearReceiveInput))).status).toBe(502);
});

it.each([nearTestInput, nearReceiveInput])("prepares once for $mode by default; a bridge config pause still permits tracking and notification", async input => {
  vi.useFakeTimers();
  const prepared = nearQuoteFixture(input);
  fetcher.mockResolvedValueOnce(Response.json(prepared));
  expect((await prepare(request(input))).status).toBe(200);
  expect((await outgoing(...fetcher.mock.calls[0]).json()).dry).toBe(false);
  expect((await prepare(request({ ...input, quote: prepared }))).status).toBe(200);
  // An already-open review keeps its original signed wait policy after an update.
  const legacy = nearQuoteFixture(input, false, {}, 10_000);
  expect((await prepare(request({ ...input, quote: legacy }))).status).toBe(200);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const paused = structuredClone(configs.currentBridgeConfig("mainnet"));
  paused.document.features[input.mode === "send" ? "bridgeOut" : "bridgeIn"] = false;
  vi.spyOn(configs, "currentBridgeConfig").mockReturnValue(paused);
  expect((await prepare(request({ ...input, quote: prepared }))).status).toBe(503);
  vi.advanceTimersByTime(700_000);
  fetcher.mockResolvedValueOnce(Response.json(nearStatus(prepared)));
  expect((await status(request({ routeId: input.routeId, quote: prepared }))).status).toBe(200);
  const statusRequest = outgoing(...fetcher.mock.calls[1]);
  expect(statusRequest.method).toBe("GET");
  expect(new URL(statusRequest.url).pathname).toBe("/v0/status");
  expect(new URL(statusRequest.url).searchParams.get("depositAddress")).toBe(prepared.quote.depositAddress);
  fetcher.mockResolvedValueOnce(Response.json(nearStatus(prepared, "KNOWN_DEPOSIT_TX")));
  expect((await deposit(request({ routeId: input.routeId, quote: prepared, txHash: nearTxHash }))).status).toBe(200);
  const notification = outgoing(...fetcher.mock.calls[2]);
  expect(notification).toMatchObject({ url: "https://1click.chaindefuser.com/v0/deposit/submit", method: "POST" });
  expect(await notification.json()).toEqual({ depositAddress: prepared.quote.depositAddress, txHash: nearTxHash });
  vi.useRealTimers();
});

it("sanitizes authorization errors and preserves the service correlation ID", async () => {
  fetcher.mockResolvedValueOnce(Response.json({ correlationId: "near-reference-123", message: "secret Bearer credential", statusCode: 401 }, { status: 401 }));
  const response = await prepare(request(nearTestInput));
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ correlationId: "near-reference-123", error: "NEAR could not authorize this quote. Contact support with the reference." });
});

it.each([
  [400, "No liquidity available", 422, "NEAR has no liquidity for this route right now. Try another provider or retry later."],
  [400, "Unrecognized upstream details containing private credentials", 502, "NEAR has no available quote for this transfer. Try another amount or provider."],
  [500, "No liquidity available", 502, "NEAR is unavailable. Retry from this receipt; do not send another deposit."],
] as const)("distinguishes unavailable liquidity from other upstream failures (%i, %s)", async (statusCode, message, expectedStatus, error) => {
  fetcher.mockResolvedValueOnce(Response.json({ message, correlationId: "near-liquidity-reference" }, { status: statusCode }));
  const response = await preview(request(nearTestInput));
  expect(response.status).toBe(expectedStatus);
  expect(await response.json()).toEqual({ error, correlationId: "near-liquidity-reference" });
});

it.each(["PENDING_DEPOSIT", "SUCCESS"] as const)("tracks %s when status omits quote metadata and returns null amounts or refund reasons", async state => {
  const input = state === "PENDING_DEPOSIT" ? nearReceiveInput : nearTestInput;
  const original = nearQuoteFixture(input, false, {}, 10_000);
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
});

it.each(["recipient", "depositAddress", "signature"])("rejects changed %s while restoring omitted status metadata", async field => {
  const original = nearQuoteFixture();
  const payload = nearStatus(structuredClone(original), "SUCCESS");
  Reflect.deleteProperty(payload.quoteResponse, "correlationId");
  Reflect.deleteProperty(payload.quoteResponse.quoteRequest, "quoteWaitingTimeMs");
  if (field === "recipient") payload.quoteResponse.quoteRequest.recipient = "0x2222222222222222222222222222222222222222";
  if (field === "depositAddress") payload.quoteResponse.quote.depositAddress = nearTestInput.midenAccount;
  if (field === "signature") payload.quoteResponse.signature = "ed25519:invalid";
  fetcher.mockResolvedValueOnce(Response.json(payload));
  expect((await status(request({ routeId: nearTestInput.routeId, quote: original }))).status).toBe(502);
});

it("never relays a mismatched status or invalid signature as delivery", async () => {
  const original = nearQuoteFixture();
  const another = nearQuoteFixture(nearTestInput, false, { depositAddress: nearTestInput.midenAccount });
  fetcher.mockResolvedValueOnce(Response.json(nearStatus(another, "SUCCESS")));
  expect((await status(request({ routeId: nearTestInput.routeId, quote: original }))).status).toBe(502);
  vi.mocked(verifyQuoteSignature).mockReturnValueOnce(false);
  expect((await status(request({ routeId: nearTestInput.routeId, quote: original }))).status).toBe(400);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("rejects an oversized request body even without a Content-Length header", async () => {
  const input = new Request("https://portal.example/api/near/quote", {
    method: "POST", body: JSON.stringify(nearTestInput) + " ".repeat(32_769),
  });
  expect((await preview(input)).status).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
});

function stalledUpstream() {
  const started = Promise.withResolvers<void>();
  fetcher.mockImplementation(() => {
    started.resolve();
    return new Promise<Response>(() => {});
  });
  return started.promise;
}

it.each([true, false])("propagates caller cancellation (already cancelled: %s)", async alreadyCancelled => {
  const controller = new AbortController();
  const started = stalledUpstream();
  if (alreadyCancelled) controller.abort();
  const response = preview(request(nearTestInput, controller.signal));
  if (!alreadyCancelled) {
    await started;
    controller.abort();
  }
  expect((await response).status).toBe(502);
  expect(fetcher).toHaveBeenCalledTimes(alreadyCancelled ? 0 : 1);
});

it.each([
  ["quote", preview, 30_000], ["status", status, 15_000], ["deposit", deposit, 15_000],
] as const)("cancels stalled %s requests at the deadline without retrying", async (operation, handler, timeout) => {
  vi.useFakeTimers();
  const started = stalledUpstream();
  const body = operation === "quote" ? nearTestInput : {
    routeId: nearTestInput.routeId, quote: nearQuoteFixture(), ...(operation === "deposit" ? { txHash: nearTxHash } : {}),
  };
  const response = handler(request(body));
  const settled = vi.fn();
  void response.then(settled);
  await started;
  await vi.advanceTimersByTimeAsync(timeout - 1);
  expect(settled).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect((await response).status).toBe(502);
  expect(fetcher).toHaveBeenCalledOnce();
});

it.each(["receive", "send"] as const)("prepares Bitcoin %s with current asset IDs, exact satoshis and the correct payment window", async mode => {
  vi.useFakeTimers();
  const input = { ...bitcoinReceiveInput, mode, routeId: mode === "receive"
    ? bitcoinReceiveInput.routeId : "mainnet:near-miden-wbtc-to-bitcoin-btc" };
  fetcher.mockResolvedValueOnce(Response.json(nearQuoteFixture(input)));
  const response = await prepare(request(input));
  expect(response.status).toBe(200);
  expect(await outgoing(...fetcher.mock.calls[0]).json()).toMatchObject({
    originAsset: mode === "receive" ? "1cs_v1:btc:native:coin" : "1cs_v1:miden:ft:0x3084d3c389ececd15fda9770d18c8a",
    destinationAsset: mode === "send" ? "1cs_v1:btc:native:coin" : "1cs_v1:miden:ft:0x3084d3c389ececd15fda9770d18c8a",
    amount: "100000", refundTo: mode === "receive" ? input.externalAddress : input.midenAccount,
    recipient: mode === "receive" ? input.midenAccount : input.externalAddress,
    deadline: new Date(Date.now() + (mode === "receive" ? 3_600_000 : 600_000)).toISOString(),
  });
});

it.each([
  ["mainnet:near-bitcoin-btc-to-miden-wbtc", bitcoinQuotes.receive.legacy, "ab".repeat(32)],
  ["mainnet:near-miden-wbtc-to-bitcoin-btc", bitcoinQuotes.send.legacy, nearTxHash],
] as const)("tracks and notifies an expired legacy Bitcoin receipt for %s with its original signed terms", async (routeId, quote, txHash) => {
  const sdk = await vi.importActual<typeof import("@defuse-protocol/one-click-sdk-typescript")>("@defuse-protocol/one-click-sdk-typescript");
  vi.mocked(verifyQuoteSignature).mockImplementation(sdk.verifyQuoteSignature);
  vi.useFakeTimers(); vi.setSystemTime(Date.parse(quote.timestamp) + 7 * 86_400_000);
  fetcher.mockImplementation(async () => Response.json({ ...nearStatus(nearQuoteSchema.parse(quote), "KNOWN_DEPOSIT_TX"),
    swapDetails: { originChainTxHashes: [{ hash: txHash }], destinationChainTxHashes: [] } }));
  const response = await status(request({ routeId, quote }));
  expect(response.status).toBe(200);
  expect((await response.json()).quoteResponse).toEqual(quote);
  expect(new URL(outgoing(...fetcher.mock.calls[0]).url).searchParams.get("depositAddress")).toBe(quote.quote.depositAddress);
  expect((await deposit(request({ routeId, quote, txHash }))).status).toBe(200);
  expect(await outgoing(...fetcher.mock.calls[1]).json()).toEqual({ depositAddress: quote.quote.depositAddress, txHash });
});

it.each([
  { destinationAsset: "nep141:miden-0x419f8f4bff72959132aa7cea15a4c1.omft.near" },
  { originAsset: "nep141:btc.omft.near" },
])("rejects unsupported legacy Bitcoin receipt aliases even after signature verification: %j", async patch => {
  const quote = nearQuoteFixture(bitcoinReceiveInput);
  Object.assign(quote.quoteRequest, patch);
  expect((await status(request({ routeId: bitcoinReceiveInput.routeId, quote }))).status).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([
  { externalAddress: "mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn" },
  { externalAddress: "1BoatSLRHtKNngkdXEeobR76b53LETtpyX" },
  { evmAddress: nearTestInput.externalAddress },
  { externalAddress: undefined }, { amount: "0.000000001" },
])("rejects unsafe Bitcoin inputs before allocating a deposit: %j", async patch => {
  expect((await prepare(request({ ...bitcoinReceiveInput, ...patch }))).status).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
});

it("relays a Bitcoin txid and accepts its native hash in status without changing EVM hash validation", async () => {
  const quote = nearQuoteFixture(bitcoinReceiveInput);
  const txHash = "ab".repeat(32);
  const body = { routeId: bitcoinReceiveInput.routeId, quote, txHash };
  fetcher.mockResolvedValueOnce(Response.json({ ...nearStatus(quote, "KNOWN_DEPOSIT_TX"),
    swapDetails: { originChainTxHashes: [{ hash: txHash }], destinationChainTxHashes: [] } }));
  expect((await deposit(request(body))).status).toBe(200);
  expect(await outgoing(...fetcher.mock.calls[0]).json()).toMatchObject({ txHash, depositAddress: quote.quote.depositAddress });
  expect((await deposit(request({ ...body, txHash: nearTxHash }))).status).toBe(400);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
