import { PRICE_REFRESH_MS, priceSymbol, type PriceSymbol, type UsdPrice } from "../../lib/token-pricing";

export const dynamic = "force-dynamic";

// Bounded to our supported market symbols, per server/Worker instance. This
// does not require the Next incremental cache (disabled on our Cloudflare app).
const prices = new Map<PriceSymbol, UsdPrice>();
const pending = new Map<PriceSymbol, Promise<UsdPrice>>();

async function fetchPrice(symbol: PriceSymbol): Promise<UsdPrice> {
  const response = await fetch(`https://api.coinbase.com/v2/prices/${symbol}-USD/spot`, {
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error("Price provider unavailable");
  const payload = await response.json();
  const data = payload?.data;
  const usd = typeof data?.amount === "string" && /^\d+(?:\.\d+)?$/.test(data.amount)
    ? Number(data.amount) : NaN;
  if (data?.base !== symbol || data?.currency !== "USD" || !Number.isFinite(usd) || usd <= 0) {
    throw new Error("Invalid price response");
  }
  const quote = { symbol, usd, fetchedAt: Date.now() };
  prices.set(symbol, quote);
  return quote;
}

export async function GET(request: Request) {
  const symbol = priceSymbol(new URL(request.url).searchParams.get("symbol") ?? "");
  const headers = { "Cache-Control": "no-store" };
  if (!symbol) {
    return Response.json({ error: "Unsupported token symbol." }, { status: 400, headers });
  }
  try {
    const cached = prices.get(symbol);
    if (cached && Date.now() - cached.fetchedAt < PRICE_REFRESH_MS) {
      return Response.json(cached, { headers });
    }
    let loading = pending.get(symbol);
    if (!loading) {
      loading = fetchPrice(symbol).finally(() => pending.delete(symbol));
      pending.set(symbol, loading);
    }
    return Response.json(await loading, { headers });
  } catch {
    return Response.json({ error: "USD price unavailable. Please retry shortly." }, { status: 502, headers });
  }
}
