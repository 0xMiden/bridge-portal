import { defineConfig } from "@playwright/test";

// Mock tier: deterministic, every-PR, no real network (MSW intercepts). The
// webServer bakes the matched E2E flags into the SUT so build+harness can't
// drift (§3.1).
const PORT = 3020;

export default defineConfig({
  testDir: "./e2e/tests/mock",
  // Generous: the first spec pays the cold `next dev` Miden-WASM compile.
  timeout: 240_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  maxFailures: 1,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: "test-results/mock-results.json" }]],
  outputDir: "test-results/mock",
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
    trace: "on",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    // Prod build + start (not `next dev`): immutable chunks, no HMR churn — dev
    // mode serves broken chunks mid-recompile under Playwright (ChunkLoadError).
    command: `npx next build --webpack && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 420_000,
    env: {
      NEXT_PUBLIC_E2E_TEST: "true",
      NEXT_PUBLIC_E2E_NETWORK: "mock",
      NEXT_PUBLIC_E2E_SIGNER_MODE: process.env.NEXT_PUBLIC_E2E_SIGNER_MODE ?? "sign",
    },
  },
});
