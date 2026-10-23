import { afterEach, beforeEach, expect, it, vi } from "vitest";

let GET: typeof import("./route").GET;
const fetchMock = vi.fn<typeof fetch>();
const read = (symbol: string) => GET(new Request(`http://localhost/api/prices?symbol=${encodeURIComponent(symbol)}`));
const spot = (base: string, amount: string) => Response.json({ data: { base, amount, currency: "USD" } });

beforeEach(async () => {
  vi.resetModules();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  ({ GET } = await import("./route"));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("shares one USD market quote across concurrent requests and USDCx aliases, then refreshes it", async () => {
  const now = vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
  fetchMock.mockResolvedValueOnce(spot("USDC", "0.9998"));
  const responses = await Promise.all([read("USDC"), read(" usdcx ")]);
  for (const response of responses) {
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ symbol: "USDC", usd: 0.9998, usdDecimal: "0.9998" });
  }
  await read("USDCx");
  expect(fetchMock).toHaveBeenCalledTimes(1);

  now.mockReturnValue(1_800_000_061_000);
  fetchMock.mockResolvedValueOnce(spot("USDC", "0.998"));
  expect(await (await read("USDCx")).json()).toMatchObject({ usd: 0.998, fetchedAt: 1_800_000_061_000 });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it.each([
  ["WSOL", "SOL"],
  ["WBNB", "BNB"],
  ["WBTC", "WBTC"],
  ["PAXG", "PAXG"],
  ["PYUSD", "PYUSD"],
  ["NEAR", "NEAR"],
  ["DAI", "DAI"],
  ["USDT", "USDT"],
])("prices %s through the %s USD market, preserving the provider's decimal", async (token, market) => {
  fetchMock.mockResolvedValueOnce(spot(market, "1.00000000000000000001"));
  const response = await read(token);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ symbol: market, usdDecimal: "1.00000000000000000001" });
  expect(fetchMock.mock.calls[0]?.[0]).toBe(`https://api.coinbase.com/v2/prices/${market}-USD/spot`);
});

it("keeps different markets separate and does not return an expired quote after an outage", async () => {
  const now = vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
  fetchMock.mockResolvedValueOnce(spot("ETH", "2455.8"));
  expect(await (await read("eth")).json()).toMatchObject({ symbol: "ETH", usd: 2455.8 });
  fetchMock.mockResolvedValueOnce(spot("USDC", "1"));
  expect(await (await read("USDC")).json()).toMatchObject({ symbol: "USDC", usd: 1 });

  now.mockReturnValue(1_800_000_061_000);
  fetchMock.mockRejectedValueOnce(new Error("Network unavailable"));
  expect((await read("ETH")).status).toBe(502);
  fetchMock.mockResolvedValueOnce(spot("ETH", "2460"));
  expect(await (await read("ETH")).json()).toMatchObject({ usd: 2460 });
});

it.each([
  () => new Response("rate limited", { status: 429 }),
  () => spot("ETH", "0"),
  () => spot("ETH", "not a price"),
  () => spot("USDC", "1"),
  () => Response.json({ data: { base: "ETH", currency: "EUR", amount: "2000" } }),
])("reports unusable upstream prices as unavailable instead of zero", async (response) => {
  fetchMock.mockResolvedValueOnce(response());
  const result = await read("ETH");
  expect(result.status).toBe(502);
  expect(await result.json()).not.toHaveProperty("usd");
});

it("rejects unsupported symbols before making an upstream request", async () => {
  for (const symbol of ["", "UNKNOWN", "__proto__", "ETH-USD/spot"]) {
    expect((await read(symbol)).status).toBe(400);
  }
  expect(fetchMock).not.toHaveBeenCalled();
});
