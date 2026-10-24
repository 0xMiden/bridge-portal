import { PRICE_REFRESH_MS, priceSymbol, type PriceSymbol, type UsdPrice } from "../../app/lib/token-pricing";
import type { MidenBalances } from "../miden-balances";
import type { BridgeRoute } from "./routes";

export const BALANCE_CAP_USD = "1232.462";
export type BalanceCapPrices = Partial<Record<PriceSymbol, UsdPrice>>;
export type BalanceCapEvaluation = {
  status: "allowed" | "exceeded" | "unavailable";
  error: string;
  balanceUsd?: string;
  remainingUsd?: string;
  depositUsd?: string;
};

type Decimal = { units: bigint; scale: number };

// Decimal coefficients preserve every token and provider digit. In particular,
// a fraction of a cent above the cap must never disappear through rounding.
function decimal(value: string): Decimal {
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(value);
  if (!match || value.length > 512) throw new Error("Invalid decimal amount");
  const exponent = Number(match[3] ?? 0);
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 324) throw new Error("Invalid decimal amount");
  let units = BigInt(match[1] + (match[2] ?? ""));
  let scale = (match[2]?.length ?? 0) - exponent;
  if (scale < 0) {
    units *= 10n ** BigInt(-scale);
    scale = 0;
  }
  return { units, scale };
}

function add(left: Decimal, right: Decimal): Decimal {
  const scale = Math.max(left.scale, right.scale);
  return {
    units: left.units * 10n ** BigInt(scale - left.scale) + right.units * 10n ** BigInt(scale - right.scale),
    scale,
  };
}

function stringify({ units, scale }: Decimal): string {
  if (scale === 0) return units.toString();
  const digits = units.toString().padStart(scale + 1, "0");
  return `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/\.?0+$/, "");
}

function displayAllowance(value: Decimal): string {
  const truncated = value.scale > 6
    ? { units: value.units / 10n ** BigInt(value.scale - 6), scale: 6 }
    : value;
  if (value.units > 0n && truncated.units === 0n) return "less than $0.000001";
  return `$${stringify(truncated)}`;
}

/** Request prices for recognized positive holdings, including non-selected tokens. */
export function priceSymbolsForBalanceCap(route: BridgeRoute, balances?: MidenBalances): PriceSymbol[] {
  if (route.mode !== "receive") return [];
  const symbols = new Set<PriceSymbol>();
  const depositSymbol = priceSymbol(route.source.symbol);
  if (depositSymbol) symbols.add(depositSymbol);
  for (const balance of Object.values(balances ?? {})) {
    const symbol = balance?.pricingSymbol && priceSymbol(balance.pricingSymbol);
    if (balance && balance.amountRaw > 0n && symbol) symbols.add(symbol);
  }
  return [...symbols].sort();
}

/**
 * Frontend bridge-in guard. Gross source value is used conservatively: fees do
 * not increase the allowance. Outbound transfers and note consumption are not
 * subject to this cap. Sum the holdings with available prices; unpriced holdings
 * are excluded. pricingSymbol comes only from the trusted faucet registry.
 */
export function evaluateBalanceCap(
  route: BridgeRoute,
  amount: string,
  balances: MidenBalances | undefined,
  prices: BalanceCapPrices,
): BalanceCapEvaluation {
  if (route.mode !== "receive") return { status: "allowed", error: "" };
  const unavailable = (error: string): BalanceCapEvaluation => ({ status: "unavailable", error });
  if (!balances) return unavailable("Load your Bread balance to check the $1,232.462 bridge-in limit.");

  const marketPrice = (symbol: PriceSymbol | null): Decimal | null => {
    const price = symbol ? prices[symbol] : undefined;
    if (!price || price.symbol !== symbol || !Number.isFinite(price.usd) || price.usd <= 0 ||
      !Number.isFinite(price.fetchedAt) || Date.now() - price.fetchedAt >= PRICE_REFRESH_MS ||
      price.fetchedAt > Date.now() + PRICE_REFRESH_MS) {
      return null;
    }
    try {
      const value = decimal(price.usdDecimal ?? String(price.usd));
      return value.units > 0n ? value : null;
    } catch {
      return null;
    }
  };

  try {
    let total: Decimal = { units: 0n, scale: 0 };
    for (const balance of Object.values(balances)) {
      if (!balance || balance.amountRaw === 0n) continue;
      const symbol = balance.pricingSymbol ? priceSymbol(balance.pricingSymbol) : null;
      const price = marketPrice(symbol);
      if (!price) continue;
      if (balance.amountRaw < 0n || !Number.isInteger(balance.decimals) || balance.decimals < 0 || balance.decimals > 255) {
        return unavailable("Your Bread balance could not be verified. Refresh the balance check before bridging in.");
      }
      total = add(total, { units: balance.amountRaw * price.units, scale: balance.decimals + price.scale });
    }
    const quantity = decimal(amount.trim());
    const price = marketPrice(priceSymbol(route.source.symbol));
    if (!price) return unavailable("Current USD prices are unavailable. Refresh the balance check before bridging in.");
    const deposit = { units: quantity.units * price.units, scale: quantity.scale + price.scale };
    const cap = decimal(BALANCE_CAP_USD);
    const difference = add(cap, { units: -total.units, scale: total.scale });
    const remaining = { ...difference, units: difference.units > 0n ? difference.units : 0n };
    const projectedExcess = add(add(total, deposit), { units: -cap.units, scale: cap.scale });
    const values = { balanceUsd: stringify(total), remainingUsd: stringify(remaining), depositUsd: stringify(deposit) };
    return projectedExcess.units > 0n
      ? { ...values, status: "exceeded", error: `For now, bridge-in deposits are limited to a total Bread balance of $1,232.462. ${remaining.units === 0n
        ? "Your account has reached this limit. Withdraw funds before bridging in again."
        : `Available to bridge in: ${displayAllowance(remaining)}. Lower the amount.`}` }
      : { ...values, status: "allowed", error: "" };
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : "Unable to verify your total USD balance. Refresh the balance check before bridging in.");
  }
}
