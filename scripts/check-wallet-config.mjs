#!/usr/bin/env node
import { withPortalEpochRoutes } from "../src/config/wallet-config/epoch-mainnet.ts";
import { readFile } from "node:fs/promises";
import { bridgeConfigSchema } from "../src/config/wallet-config/schema.ts";
import { assertTokenConnections, tokenConnectionsSchema } from "../src/config/wallet-config/token-connections.ts";

const registry = tokenConnectionsSchema.parse(JSON.parse(await readFile(
  new URL("../src/config/wallet-config/token-connections.json", import.meta.url), "utf8",
)));

// Offline release gate: builds must use a complete, matching pair of generated files.
let revision;
for (const environment of ["testnet", "mainnet"]) {
  const file = new URL(`../src/config/wallet-config/${environment}.json`, import.meta.url);
  const value = JSON.parse(await readFile(file, "utf8"));
  const config = bridgeConfigSchema.parse(value);
  assertTokenConnections(bridgeConfigSchema.parse(withPortalEpochRoutes(config)), registry[environment]);
  if (config.environment !== environment || !/^[a-f0-9]{40}$/.test(value.revision ?? "")) {
    throw new Error(`Invalid generated ${environment} configuration`);
  }
  if (revision && revision !== value.revision) throw new Error("Network configurations must use the same wallet-config revision");
  revision = value.revision;
  console.log(`${environment}: config v${config.document.version}, revision ${revision}`);
}
