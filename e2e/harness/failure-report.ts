import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { NetworkCapture } from "./network-capture";
import type { TestStepRunner } from "./test-step";
import type { TimelineRecorder } from "./timeline-recorder";
import type { FailureCategory, TestFailureReport } from "./types";

// Machine-readable failure report (§3.5): category + hints + state-at-failure, so
// an agent/human reads this instead of scraping logs.

function classify(
  error: Error,
  capture: NetworkCapture,
): { category: FailureCategory; hints: string[] } {
  const msg = error.message.toLowerCase();
  const hints: string[] = [];
  let category: FailureCategory = "unknown";

  if (/user rejected|4001|denied/.test(msg)) category = "wallet_rejected";
  else if (/timed out|timeout/.test(msg)) {
    category = "timeout_waiting_for_tx";
    hints.push("A transaction/monitor step exceeded its deadline.");
  } else if (/expect|to be|received/.test(msg)) category = "assertion_value_mismatch";
  else if (/locator|element|selector|waiting for/.test(msg))
    category = "ui_element_not_found";

  if (capture.failedRequests.length > 0) {
    if (category === "unknown") category = "network_error";
    hints.push(
      `${capture.failedRequests.length} network request(s) failed — check backend/RPC connectivity.`,
    );
  }
  if (capture.consoleErrors.length > 0) {
    if (category === "unknown") category = "browser_console_error";
    hints.push(`${capture.consoleErrors.length} browser console error(s) captured.`);
  }
  return { category, hints };
}

export function writeFailureReport(args: {
  filePath: string;
  testName: string;
  testFile: string;
  error: Error;
  wasTimeout: boolean;
  steps: TestStepRunner;
  capture: NetworkCapture;
  timeline: TimelineRecorder;
  stateAtFailure?: unknown;
}): void {
  const { category, hints } = classify(args.error, args.capture);
  const report: TestFailureReport = {
    testName: args.testName,
    testFile: args.testFile,
    status: args.wasTimeout ? "timedout" : "failed",
    failureCategory: category,
    diagnosticHints: hints,
    error: { message: args.error.message, stack: args.error.stack },
    failedAtStep: args.steps.getFailedAt(),
    stepSummary: args.steps.getSummary(),
    stateAtFailure: args.stateAtFailure,
    failedRequests: args.capture.failedRequests,
    browserErrors: args.capture.consoleErrors,
    recentEvents: args.timeline.recent(50),
    timing: { totalDurationMs: args.timeline.totalMs(), wasTimeout: args.wasTimeout },
    artifacts: { timeline: `${dirname(args.filePath)}/timeline.jsonl` },
  };
  mkdirSync(dirname(args.filePath), { recursive: true });
  writeFileSync(args.filePath, JSON.stringify(report, null, 2));
}
