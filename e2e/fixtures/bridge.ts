import { test as base } from "@playwright/test";
import { join } from "node:path";
import { NetworkCapture } from "../harness/network-capture";
import { TestStepRunner } from "../harness/test-step";
import { TimelineRecorder } from "../harness/timeline-recorder";
import { writeFailureReport } from "../harness/failure-report";
import { stubNetwork } from "./mock-network";
import { BridgePage } from "../pages/bridge-page";

// The lifecycle engine (§3.4): boots the page-object, waits-for-ready on the
// gated window hook, wires observability, and on failure writes the
// machine-readable report + (agentic mode) pauses with the browser open.
type Fixtures = {
  timeline: TimelineRecorder;
  steps: TestStepRunner;
  bridge: BridgePage;
};

export const test = base.extend<Fixtures>({
  timeline: async ({}, use, testInfo) => {
    await use(new TimelineRecorder(join(testInfo.outputDir, "timeline.jsonl")));
  },
  steps: async ({ timeline }, use) => {
    await use(new TestStepRunner(timeline));
  },
  bridge: async ({ page, timeline, steps }, use, testInfo) => {
    const capture = new NetworkCapture(page, timeline);
    capture.attach();
    timeline.record("test_lifecycle", `start ${testInfo.title}`);

    const bridge = new BridgePage(page);
    // Mock tier only: register offline stubs before the first navigation.
    if (process.env.E2E_NETWORK === "mock") await stubNetwork(page);
    await page.goto("/");
    await bridge.waitForReady().catch(() => {
      timeline.record("error", "wallets did not reach ready", {
        severity: "warn",
      });
    });

    await use(bridge);

    if (testInfo.status && testInfo.status !== testInfo.expectedStatus) {
      const error = testInfo.errors[0] ?? { message: "unknown failure" };
      const stateAtFailure = await page
        .evaluate(() => ({
          hook: window.__E2E__
            ? {
                evmAddress: window.__E2E__.evmAddress,
                midenAddress: window.__E2E__.midenAddress,
                ready: window.__E2E__.ready,
              }
            : null,
          activities: window.__E2E__?.readActivities?.() ?? [],
        }))
        .catch(() => undefined);

      writeFailureReport({
        filePath: join(testInfo.outputDir, "report.json"),
        testName: testInfo.title,
        testFile: testInfo.file,
        error: { message: error.message, stack: error.stack } as Error,
        wasTimeout: testInfo.status === "timedOut",
        steps,
        capture,
        timeline,
        stateAtFailure,
      });

      if (process.env.E2E_AGENTIC === "true") {
        timeline.record("test_lifecycle", "agentic pause — browser left open");
        await page.pause();
      }
    }
  },
});

export { expect } from "@playwright/test";
