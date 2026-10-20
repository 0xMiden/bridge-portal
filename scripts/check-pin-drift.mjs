#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";

const snapshots = JSON.parse(await readFile("src/config/wallet-config/snapshots.json", "utf8"));
const portalPkg = JSON.parse(await readFile("package.json", "utf8"));
async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}
const environments = ["testnet", "mainnet"];
const [walletPkg, ...documents] = await Promise.all([
  json("https://raw.githubusercontent.com/0xMiden/wallet/main/package.json"),
  ...environments.map(environment => json(`https://raw.githubusercontent.com/0xMiden/wallet-config/main/${environment}.json`)),
]);
// Ignore unrelated wallet settings (earn, swap, geography, document version).
// Compare only the manifest inputs this portal actually consumes.
function bridgeInputs(document) {
  return {
    providers: document["bridge-providers"],
    chains: document.supportedEvmChains,
    features: Object.fromEntries(["fastBridge", "bridgeIn", "bridgeOut"].map(key => [key, document.features[key]])),
  };
}
const drifts = [];
const sdk = portalPkg.dependencies["@miden-sdk/miden-sdk"];
if (sdk !== walletPkg.dependencies["@miden-sdk/miden-sdk"])
  drifts.push(`SDK: portal=${sdk} wallet=${walletPkg.dependencies["@miden-sdk/miden-sdk"]}`);
for (const [index, environment] of environments.entries()) {
  const snapshot = snapshots.findLast(value => value.environment === environment);
  if (!snapshot) throw new Error(`Missing ${environment} snapshot`);
  if (!isDeepStrictEqual(bridgeInputs(snapshot.document), bridgeInputs(documents[index])))
    drifts.push(`${environment}: imported v${snapshot.document.version} at ${snapshot.revision}; review wallet-config main v${documents[index].version}`);
}
if (drifts.length) {
  console.error("check-pin-drift: review upstream changes before importing a new pinned revision:");
  for (const drift of drifts) console.error(`  ${drift}`);
  process.exitCode = 1;
} else {
  console.log(`check-pin-drift: ok (SDK ${sdk}, both wallet-config bridge configurations match upstream)`);
}
