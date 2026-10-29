import { defineConfig } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

// Only the isolated runner may collect or execute this suite. This is a harness
// guard, never a product configuration switch.
const runRoot = process.env.HELPER_BROWSER_RUN_ROOT;
const port = Number(process.env.HELPER_BROWSER_PORT);
if (!runRoot || !Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Run node scripts/test-helper-browser.mjs to prepare the isolated helper build.");
const marker = JSON.parse(readFileSync(path.join(process.cwd(), ".helper-fixture.json"), "utf8"));
if (marker.testOnly !== true || marker.runRoot !== runRoot || marker.sourceRoot !== process.cwd())
  throw new Error("The helper fixture marker does not identify this owned build.");

export default defineConfig({
  testDir: "./e2e/tests/helper",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: path.join(runRoot, "playwright-results.json") }]],
  outputDir: path.join(runRoot, "playwright-artifacts"),
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    serviceWorkers: "block",
  },
  webServer: {
    command: `node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 90_000,
  },
});
