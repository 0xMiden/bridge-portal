export type PriceSymbol = "ETH" | "USDC" | "DAI" | "USDT" | "WBTC" | "SOL" | "NEAR" | "PAXG" | "BNB" | "PYUSD" | "USDG" | "POL";

export type UsdPrice = {
  symbol: PriceSymbol;
  usd: number;
  /** Original provider decimal, retained for exact balance-limit arithmetic. */
  usdDecimal?: string;
  fetchedAt: number;
};

export const PRICE_REFRESH_MS = 60_000;

/** Explicit aliases for our supported assets; unknown symbols have no price. */
export function priceSymbol(symbol: string): PriceSymbol | null {
  switch (symbol.trim().toUpperCase()) {
    case "ETH": return "ETH";
    case "USDC":
    case "USDCX": return "USDC";
    case "DAI": return "DAI";
    case "USDT": return "USDT";
    case "WBTC": return "WBTC";
    case "WSOL":
    case "SOL": return "SOL";
    case "NEAR": return "NEAR";
    case "PAXG": return "PAXG";
    case "WBNB":
    case "BNB": return "BNB";
    case "PYUSD": return "PYUSD";
    case "USDG": return "USDG";
    case "POL": return "POL";
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
