#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { walletDocumentSchema } from "../src/config/wallet-config/schema.ts";

const portalPkg = JSON.parse(await readFile("package.json", "utf8"));
async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}
const walletPkg = await json("https://raw.githubusercontent.com/0xMiden/wallet/main/package.json");
const drifts = [];
const sdk = portalPkg.dependencies["@miden-sdk/miden-sdk"];
if (sdk !== walletPkg.dependencies["@miden-sdk/miden-sdk"])
  drifts.push(`SDK: portal=${sdk} wallet=${walletPkg.dependencies["@miden-sdk/miden-sdk"]}`);
for (const network of ["testnet", "mainnet"]) {
  const pinned = JSON.parse(await readFile(new URL(`../src/config/wallet-config/${network}.json`, import.meta.url), "utf8"));
  const upstream = walletDocumentSchema.parse(await json(`https://raw.githubusercontent.com/0xMiden/wallet-config/main/${network}.json`));
  if (!isDeepStrictEqual(pinned.document, upstream)) {
    drifts.push(`${network} wallet-config: portal=v${pinned.document.version} upstream=v${upstream.version}`);
  }
}
if (drifts.length) {
  console.error("check-pin-drift: review upstream changes before updating the SDK or wallet-config pin:");
  for (const drift of drifts) console.error(`  ${drift}`);
  process.exitCode = 1;
} else {
  console.log(`check-pin-drift: ok (SDK ${sdk}, both wallet-config documents match)`);
}
