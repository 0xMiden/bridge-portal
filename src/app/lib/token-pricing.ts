export type PriceSymbol = "ETH" | "USDC";

export type UsdPrice = {
  symbol: PriceSymbol;
  usd: number;
  fetchedAt: number;
};

export const PRICE_REFRESH_MS = 60_000;

/** Explicit aliases for our supported assets; unknown symbols have no price. */
export function priceSymbol(symbol: string): PriceSymbol | null {
  switch (symbol.trim().toUpperCase()) {
    case "ETH": return "ETH";
    case "USDC":
    case "USDCX": return "USDC";
    default: return null;
  }
}

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Display estimates only: transaction amounts retain their original precision. */
export function formatUsdAmount(amount: string, price?: number): string | null {
  const input = amount.trim();
  if (input === "") return usdFormatter.format(0);
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(input)) return null;
  const quantity = Number(input);
  if (!Number.isFinite(quantity)) return null;
  if (quantity === 0) return usdFormatter.format(0);
  if (price === undefined || !Number.isFinite(price) || price <= 0) return null;
  const value = quantity * price;
  return Number.isFinite(value) ? usdFormatter.format(value) : null;
}
