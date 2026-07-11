import { defineConfig } from "@playwright/test";

// Full E2E tier: nothing mocked at the chain layer; real Sepolia + Miden
// testnet. Fail-fast posture (§3.7): serial, no retries, stop on first failure,
// always-on traces. globalSetup funds-to-a-floor before the suite (§3.3).
const PORT = 3021;

// Forward the funded-account secrets into the SUT build (browser-side signers).
const walletEnv = {
  NEXT_PUBLIC_E2E_TEST: "true",
  NEXT_PUBLIC_E2E_NETWORK: "testnet",
  NEXT_PUBLIC_E2E_SIGNER_MODE: process.env.NEXT_PUBLIC_E2E_SIGNER_MODE ?? "sign",
  NEXT_PUBLIC_E2E_EVM_PRIVATE_KEY: process.env.E2E_EVM_PRIVATE_KEY ?? "",
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
