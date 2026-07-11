import { defineConfig } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";

// Load .env.e2e (Playwright doesn't auto-load it). Simple KEY=VALUE parser;
// existing process.env wins so CI secrets aren't overridden.
if (existsSync(".env.e2e")) {
  for (const line of readFileSync(".env.e2e", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

// Full E2E tier: nothing mocked at the chain layer; real Sepolia + Miden
// testnet. Fail-fast posture (§3.7): serial, no retries, stop on first failure,
// always-on traces. globalSetup funds-to-a-floor before the suite (§3.3).
const PORT = 3021;

// Normalise a private key to 0x-prefixed hex (accept keys pasted without it).
const evmKey = process.env.E2E_EVM_PRIVATE_KEY
  ? process.env.E2E_EVM_PRIVATE_KEY.startsWith("0x")
    ? process.env.E2E_EVM_PRIVATE_KEY
    : `0x${process.env.E2E_EVM_PRIVATE_KEY}`
  : "";
process.env.E2E_EVM_PRIVATE_KEY = evmKey; // normalise for the driver too

// Forward the funded-account secrets into the SUT build (browser-side signers).
const walletEnv = {
  NEXT_PUBLIC_E2E_TEST: "true",
  NEXT_PUBLIC_E2E_NETWORK: "testnet",
  NEXT_PUBLIC_E2E_SIGNER_MODE: process.env.NEXT_PUBLIC_E2E_SIGNER_MODE ?? "sign",
  NEXT_PUBLIC_E2E_EVM_PRIVATE_KEY: evmKey,
  NEXT_PUBLIC_E2E_MIDEN_SEED: process.env.E2E_MIDEN_SEED ?? "",
  NEXT_PUBLIC_E2E_MIDEN_ACCOUNT_ID: process.env.E2E_MIDEN_ACCOUNT_ID ?? "",
};

export default defineConfig({
  testDir: "./e2e/tests/e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 300_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  maxFailures: 1,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: "test-results/e2e-results.json" }]],
  outputDir: "test-results/e2e",
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
    trace: "on",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    // Prod build + start for stable chunks (see mock config note).
    command: `npx next build --webpack && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 600_000,
    env: walletEnv,
  },
});
