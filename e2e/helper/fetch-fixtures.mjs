import assert from "node:assert/strict";
import fs from "node:fs";

// Test-process preload only. Ordinary builds/start never load this file.
const marker = JSON.parse(fs.readFileSync(".helper-fixture.json", "utf8"));
assert(marker.testOnly === true && marker.sourceRoot === process.cwd());
const target = new URL(process.env.HELPER_FIXTURE_CIRCLE_URL);
assert(target.protocol === "http:" && target.hostname === "127.0.0.1");
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.origin === "https://xreserve-api-testnet.circle.com" && url.pathname === "/v1/attestations") {
    assert(!init?.method || init.method === "GET");
    return originalFetch(`${target.origin}${url.pathname}${url.search}`, init);
  }
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("Unconfigured nonloopback fixture request");
  return originalFetch(input, init);
};
