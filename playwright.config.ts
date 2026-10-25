import { defineConfig } from "@playwright/test";

// Browser integration tests run the ordinary production build without wallet keys.
const PORT = 3020;

export default defineConfig({
  testDir: "./e2e/tests/mock",
  timeout: 240_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  maxFailures: 1,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: "test-results/browser-results.json" }]],
  outputDir: "test-results/browser",
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
    // Public application configuration, not a wallet credential. Discovery's
    // remote responses are intercepted by Playwright, so CI needs no account.
    env: { NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: "00000000000000000000000000000000" },
  },
});
