// Trimmed observability types for the web-app harness (ported from the wallet's
// playwright/e2e/harness/types.ts, minus the wallet/service-worker specifics).

export type EventCategory =
  | "test_lifecycle"
  | "ui_action"
  | "ui_assertion"
  | "cli_command"
  | "onchain_state"
  | "browser_console"
  | "network_request"
  | "state_snapshot"
  | "error";

export type EventSeverity = "info" | "warn" | "error" | "debug";

export interface TimelineEvent {
  timestamp: string;
  elapsedMs: number;
  stepIndex: number;
  stepName: string;
  category: EventCategory;
  severity: EventSeverity;
  message: string;
  data?: Record<string, unknown>;
  durationMs?: number;
}

export type FailureCategory =
  | "ui_element_not_found"
  | "assertion_value_mismatch"
  | "timeout_waiting_for_tx"
  | "wallet_rejected"
  | "network_error"
  | "browser_console_error"
  | "app_crash"
  | "unknown";

export interface NetworkRecord {
  url: string;
  method: string;
  status?: number;
  ok?: boolean;
  failureText?: string;
  timestamp: string;
}

export interface StepSummary {
  index: number;
  name: string;
  status: "passed" | "failed" | "skipped";
  durationMs: number;
}

export interface TestFailureReport {
  testName: string;
  testFile: string;
  status: "failed" | "timedout";
  failureCategory: FailureCategory;
  diagnosticHints: string[];
  error: { message: string; stack?: string };
  failedAtStep?: { index: number; name: string };
  stepSummary: StepSummary[];
  stateAtFailure?: unknown;
  failedRequests: NetworkRecord[];
  browserErrors: string[];
  recentEvents: TimelineEvent[];
  timing: { totalDurationMs: number; wasTimeout: boolean };
  artifacts: { timeline: string };
}
