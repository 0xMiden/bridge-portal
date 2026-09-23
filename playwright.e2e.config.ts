import { defineConfig } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";

function loadDotEnv(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = value;
  }
}

loadDotEnv(".env.e2e");

const PORT = 3021;

export default defineConfig({
  testDir: "./e2e/tests/testnet",
  globalSetup: "./e2e/tests/testnet/global-setup.ts",
  timeout: 360_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  maxFailures: 1,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: "test-results/testnet-results.json" }]],
  outputDir: "test-results/testnet",
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
    trace: "on",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: `npx next build --webpack && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 420_000,
    env: {
      NEXT_PUBLIC_E2E_TEST: "true",
      NEXT_PUBLIC_E2E_NETWORK: "testnet",
      NEXT_PUBLIC_E2E_SIGNER_MODE: "sign",
      NEXT_PUBLIC_E2E_EVM_PRIVATE_KEY: process.env.E2E_EVM_PRIVATE_KEY ?? "",
      NEXT_PUBLIC_E2E_MIDEN_SEED: process.env.E2E_MIDEN_SEED ?? "",
      NEXT_PUBLIC_E2E_MIDEN_ACCOUNT_ID: process.env.E2E_MIDEN_ACCOUNT_ID ?? "",
    },
  },
});
