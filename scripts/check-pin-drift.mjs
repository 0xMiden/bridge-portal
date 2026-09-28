#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const WALLET_PKG =
  "https://raw.githubusercontent.com/0xMiden/wallet/main/package.json";
const WALLET_B2AGG =
  "https://raw.githubusercontent.com/0xMiden/wallet/main/src/lib/agglayer/b2agg/constant.ts";
const WALLET_AGGLAYER =
  "https://raw.githubusercontent.com/0xMiden/wallet/main/src/lib/agglayer/constant.ts";

function pickConst(source, name) {
  const match = source.match(
    new RegExp(`export const ${name} = ['"]([^'"]+)['"]`),
  );
  return match?.[1] ?? null;
}

const portalPkg = JSON.parse(await readFile("package.json", "utf8"));
const portalSdk = portalPkg.dependencies["@miden-sdk/miden-sdk"];
const portalB2agg = await readFile("src/app/lib/agglayer-b2agg.ts", "utf8");
const portalBridge = pickConst(portalB2agg, "MIDEN_BRIDGE_ID");
const portalFaucet = pickConst(portalB2agg, "MIDEN_AGGLAYER_FAUCET_ID");

const walletPkgRes = await fetch(WALLET_PKG);
if (!walletPkgRes.ok) {
  throw new Error(`wallet package.json HTTP ${walletPkgRes.status}`);
}
const walletPkg = await walletPkgRes.json();
const walletSdk = walletPkg.dependencies["@miden-sdk/miden-sdk"];

const walletB2aggRes = await fetch(WALLET_B2AGG);
if (!walletB2aggRes.ok) {
  throw new Error(`wallet b2agg/constant.ts HTTP ${walletB2aggRes.status}`);
}
const walletB2agg = await walletB2aggRes.text();
const walletBridge = pickConst(walletB2agg, "MIDEN_BRIDGE_ID");
const walletFaucet = pickConst(walletB2agg, "MIDEN_AGGLAYER_FAUCET_ID");

const walletAgglayerRes = await fetch(WALLET_AGGLAYER);
if (!walletAgglayerRes.ok) {
  throw new Error(`wallet agglayer/constant.ts HTTP ${walletAgglayerRes.status}`);
}
const walletAgglayer = await walletAgglayerRes.text();
const portalAgglayer = await readFile("src/app/lib/agglayer.ts", "utf8");
const portalNetwork = portalAgglayer.match(/destinationNetworkId:\s*(\d+)/)?.[1];
const walletNetwork = walletAgglayer.match(/export const MIDEN_CHAIN_ID\s*=\s*(\d+)/)?.[1];
if (!portalBridge || !walletBridge || !portalFaucet || !walletFaucet ||
    !portalNetwork || !walletNetwork || !portalSdk || !walletSdk) {
  throw new Error("Unable to read required deployment pins; check upstream configuration format.");
}

const drifts = [];
if (portalNetwork !== walletNetwork) {
  drifts.push(`Agglayer rollup ID: portal=${portalNetwork} wallet=${walletNetwork}`);
}
if (portalSdk !== walletSdk) {
  drifts.push(`@miden-sdk/miden-sdk: portal=${portalSdk} wallet=${walletSdk}`);
}
if (portalBridge && walletBridge && portalBridge !== walletBridge) {
  drifts.push(`MIDEN_BRIDGE_ID: portal=${portalBridge} wallet=${walletBridge}`);
}
if (portalFaucet && walletFaucet && portalFaucet !== walletFaucet) {
  drifts.push(
    `MIDEN_AGGLAYER_FAUCET_ID: portal=${portalFaucet} wallet=${walletFaucet}`,
  );
}

if (drifts.length === 0) {
  console.log(
    `check-pin-drift: ok (sdk ${portalSdk}, rollup ${portalNetwork}, bridge ${portalBridge}, faucet ${portalFaucet})`,
  );
  process.exit(0);
}

console.error("check-pin-drift: portal drifted from wallet main:");
for (const line of drifts) console.error(`  ${line}`);
process.exit(1);
