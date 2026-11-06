import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST as preview } from "./quote/route";
import { POST as prepare } from "./prepare/route";
import { POST as status } from "./status/route";
import { POST as deposit } from "./deposit/submit/route";
import { nearTestInput, signedNearQuote, nearStatus, nearTxHash } from "../../../../test/near-quotes";

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
      refundTo: nearTestInput.midenAccount, confidentiality: "basic", swapType: "EXACT_INPUT" });
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

it("prepares one executable quote then revalidates the same deposit; pause still permits tracking and notification", async () => {
  vi.useFakeTimers();
  const prepared = signedNearQuote();
  fetcher.mockResolvedValueOnce(Response.json(prepared));
  expect((await prepare(request(nearTestInput))).status).toBe(200);
  expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string).dry).toBe(false);
  expect((await prepare(request({ ...nearTestInput, quote: prepared }))).status).toBe(200);
  expect(fetcher).toHaveBeenCalledTimes(1);
  vi.stubEnv("NEAR_TRANSFERS_ENABLED", "false");
  expect((await prepare(request({ ...nearTestInput, quote: prepared }))).status).toBe(503);
  vi.advanceTimersByTime(700_000);
  fetcher.mockResolvedValueOnce(Response.json(nearStatus(prepared)));
  expect((await status(request({ routeId: nearTestInput.routeId, quote: prepared }))).status).toBe(200);
  fetcher.mockResolvedValueOnce(Response.json(nearStatus(prepared, "KNOWN_DEPOSIT_TX")));
  expect((await deposit(request({ routeId: nearTestInput.routeId, quote: prepared, txHash: nearTxHash }))).status).toBe(200);
  vi.useRealTimers();
});

it("sanitizes authorization errors and preserves the service correlation ID", async () => {
  fetcher.mockResolvedValueOnce(Response.json({ correlationId: "near-reference-123", message: "secret Bearer credential", statusCode: 401 }, { status: 401 }));
  const response = await prepare(request(nearTestInput));
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ correlationId: "near-reference-123", error: "NEAR could not authorize this quote. Contact support with the reference." });
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
