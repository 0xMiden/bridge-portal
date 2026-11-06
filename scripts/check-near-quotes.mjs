#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { verifyQuoteSignature } from "@defuse-protocol/one-click-sdk-typescript";
import { nearConfigSchema } from "../src/config/wallet-config/schema.ts";

const { values } = parseArgs({ options: { recipient: { type: "string" }, refund: { type: "string" }, output: { type: "string" } } });
if (!/^0x[\da-f]{40}$/i.test(values.recipient ?? "") || !/^mm1/.test(values.refund ?? "")) {
  throw new Error("Usage: npm run check:near-quotes -- --recipient 0x… --refund mm1… [--output report.json]");
}
const config = nearConfigSchema.parse(JSON.parse(await readFile(new URL("../src/config/near/v1.json", import.meta.url), "utf8")));
const api = "https://1click.chaindefuser.com/v0";
const headers = { "Content-Type": "application/json", ...(process.env.NEAR_API_KEY ? { Authorization: `Bearer ${process.env.NEAR_API_KEY}` } : {}) };
const tokensResponse = await fetch(`${api}/tokens`, { signal: AbortSignal.timeout(15_000), redirect: "error", cache: "no-store" });
if (!tokensResponse.ok) throw new Error(`Catalog unavailable (${tokensResponse.status})`);
const tokens = await tokensResponse.json();
const chains = { ethereum: "eth", base: "base", arbitrum: "arb", polygon: "pol", robinhood: "hood" };
const report = { checkedAt: new Date().toISOString(), kind: "dry-quotes-only", version: config.version, routes: [] };
for (const route of config.routes) {
  const source = tokens.find(token => token.assetId === route.source.assetId);
  const destination = tokens.find(token => token.assetId === route.destination.assetId);
  if (source?.blockchain !== "miden" || source.decimals !== route.source.decimals) throw new Error(`Source catalog mismatch: ${route.id}`);
  if (destination?.blockchain !== chains[route.destination.network] || destination.decimals !== route.destination.decimals) throw new Error(`Destination catalog mismatch: ${route.id}`);
  if (route.destination.kind === "erc20" && destination.contractAddress?.toLowerCase() !== route.destination.address.toLowerCase()) throw new Error(`Contract mismatch: ${route.id}`);
  // Roughly $5 is only a live-validation sample, never a portal minimum.
  const price = String(source.price);
  if (!/^\d+(\.\d+)?$/.test(price) || Number(price) <= 0) throw new Error(`Missing source price: ${route.id}`);
  const [whole, fraction = ""] = price.split(".");
  const priceUnits = BigInt(whole + fraction);
  const amount = (5n * 10n ** BigInt(route.source.decimals + fraction.length) / priceUnits).toString();
  const request = { dry: true, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: source.assetId, destinationAsset: destination.assetId,
    depositType: "ORIGIN_CHAIN", recipientType: "DESTINATION_CHAIN", refundType: "ORIGIN_CHAIN", confidentiality: "basic",
    amount, recipient: values.recipient, refundTo: values.refund, quoteWaitingTimeMs: 10_000, deadline: new Date(Date.now() + 600_000).toISOString() };
  const response = await fetch(`${api}/quote`, { method: "POST", headers, body: JSON.stringify(request), signal: AbortSignal.timeout(15_000), redirect: "error", cache: "no-store" });
  const data = await response.json();
  const valid = response.ok && verifyQuoteSignature(data) && data.quote?.amountIn === amount &&
    BigInt(data.quote?.minAmountOut ?? "0") > 0n && Object.entries(request).every(([key, value]) => data.quoteRequest?.[key] === value);
  report.routes.push({ routeId: route.id, valid, httpStatus: response.status, correlationId: data.correlationId,
    amountIn: amount, amountOut: data.quote?.amountOut, minimumOut: data.quote?.minAmountOut, estimatedSeconds: data.quote?.timeEstimate });
  console.log(`${valid ? "PASS" : "FAIL"} ${route.id}`);
}
if (values.output) await writeFile(values.output, `${JSON.stringify(report, null, 2)}\n`);
if (report.routes.some(route => !route.valid)) process.exitCode = 1;
