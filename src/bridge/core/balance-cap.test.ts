import { afterEach, expect, it, vi } from "vitest";
import { evaluateBalanceCap, priceSymbolsForBalanceCap, type BalanceCapPrices } from "./balance-cap";
import { findBridgeRoute } from "./routes";
import type { MidenBalances } from "../miden-balances";
import type { PriceSymbol } from "../../app/lib/token-pricing";

const receive = findBridgeRoute("xreserve-usdc-to-miden")!;
const send = findBridgeRoute("xreserve-usdc-to-arc")!;
const now = 1_800_000_000_000;
const prices = (values: Partial<Record<PriceSymbol, string>>): BalanceCapPrices => Object.fromEntries(
  Object.entries(values).map(([symbol, usdDecimal]) => [symbol, { symbol, usd: Number(usdDecimal), usdDecimal, fetchedAt: now }]),
);
const holding = (symbol: string | undefined, amountRaw: bigint, decimals = 6) => ({
  faucetId: `faucet-${symbol}`, pricingSymbol: symbol, symbol: symbol ?? "Unknown asset", amountRaw, decimals, balance: "unused",
});

afterEach(() => vi.restoreAllMocks());

it.each([
  ["232.462", "allowed"],
  ["232.462001", "exceeded"],
  ["300", "exceeded"],
])("checks the existing $1,000 balance plus a %s deposit against the exact cap", (amount, status) => {
  vi.spyOn(Date, "now").mockReturnValue(now);
  const result = evaluateBalanceCap(receive, amount, { usdc: holding("USDCx", 1_000_000_000n) }, prices({ USDC: "1" }));
  expect(result).toMatchObject({ status, balanceUsd: "1000", remainingUsd: "232.462" });
  if (status === "exceeded") expect(result.error).toContain("$1,232.462");
});

it("values all account holdings, even when a different token is selected for deposit", () => {
  vi.spyOn(Date, "now").mockReturnValue(now);
  const balances: MidenBalances = {
    usdc: holding("USDCx", 100_000_000n),
    eth: holding("ETH", 30_000_000n, 8),
    bitcoin: holding("WBTC", 100_000n, 8),
    zero: holding(undefined, 0n),
  };
  const result = evaluateBalanceCap(receive, "300", balances, prices({ USDC: "1", ETH: "3000", WBTC: "100000" }));
  expect(result).toMatchObject({ status: "exceeded", balanceUsd: "1100", remainingUsd: "132.462" });
  expect(priceSymbolsForBalanceCap(receive, balances)).toEqual(["ETH", "USDC", "WBTC"]);
});

it("does not round an over-limit amount down through floating point or UI precision", () => {
  vi.spyOn(Date, "now").mockReturnValue(now);
  const result = evaluateBalanceCap(receive, "1232.462", {}, prices({ USDC: "1.00000000000000000001" }));
  expect(result.status).toBe("exceeded");
  expect(result.depositUsd).toBe("1232.46200000000000001232462");
});

it("floors the displayed allowance instead of encouraging an over-limit deposit", () => {
  vi.spyOn(Date, "now").mockReturnValue(now);
  const result = evaluateBalanceCap(receive, "300", { eth: holding("ETH", 100_000_001n, 8) }, prices({ USDC: "1", ETH: "1000.00000001" }));
  expect(result.status).toBe("exceeded");
  expect(result.error).toContain("$232.461989");
});

it.each([
  ["unknown faucet", { ...holding(undefined, 1_000_000_000n), symbol: "USDC" }, {}],
  ["unsupported market", holding("UNLISTED", 1_000_000_000n), {}],
  ["missing price", holding("ETH", 100_000_000n, 8), {}],
  ["stale price", holding("ETH", 100_000_000n, 8), { ETH: { symbol: "ETH", usd: 3000, fetchedAt: now - 60_000 } }],
  ["invalid price", holding("ETH", 100_000_000n, 8), { ETH: { symbol: "ETH", usd: 3000, usdDecimal: "invalid", fetchedAt: now } }],
] satisfies Array<[string, ReturnType<typeof holding>, BalanceCapPrices]>)("excludes a holding with an %s while still enforcing the cap on priced assets", (_, unpriced, otherPrices) => {
  vi.spyOn(Date, "now").mockReturnValue(now);
  const balances = { unpriced, usdc: holding("USDCx", 1_000_000_000n) };
  const marketPrices = { ...prices({ USDC: "1" }), ...otherPrices };
  expect(evaluateBalanceCap(receive, "232.462", balances, marketPrices)).toMatchObject({
    status: "allowed", error: "", balanceUsd: "1000", remainingUsd: "232.462",
  });
  expect(evaluateBalanceCap(receive, "300", balances, marketPrices).status).toBe("exceeded");
});

it.each([
  [undefined, prices({ USDC: "1" })],
  [{ usdc: holding("USDCx", 1n) }, {}],
  [{ usdc: holding("USDCx", 1n) }, { USDC: { symbol: "USDC", usd: 1, usdDecimal: "1", fetchedAt: now - 60_000 } }],
  [{ usdc: holding("USDCx", 1n) }, { USDC: { symbol: "USDC", usd: 0, usdDecimal: "0", fetchedAt: now } }],
] satisfies Array<[MidenBalances | undefined, BalanceCapPrices]>)("requires a balance snapshot and a current price for the deposit itself", (balances, marketPrices) => {
  vi.spyOn(Date, "now").mockReturnValue(now);
  expect(evaluateBalanceCap(receive, "1", balances, marketPrices).status).toBe("unavailable");
});

it("keeps withdrawals available without a balance valuation", () => {
  expect(evaluateBalanceCap(send, "2000", undefined, {})).toEqual({ status: "allowed", error: "" });
  expect(priceSymbolsForBalanceCap(send)).toEqual([]);
});
