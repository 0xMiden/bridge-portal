import type { Page } from "@playwright/test";
import type { TimelineRecorder } from "./timeline-recorder";
import type { NetworkRecord } from "./types";

// Capture at the page layer (§3.5): app fetches (incl. the Next /api routes) and
// browser console. A web app has no service worker to instrument, so this single
// layer covers what the wallet needed four layers for.
export class NetworkCapture {
  readonly failedRequests: NetworkRecord[] = [];
  readonly consoleErrors: string[] = [];

  constructor(
    private readonly page: Page,
    private readonly timeline: TimelineRecorder,
  ) {}

  attach(): void {
    this.page.on("requestfailed", (req) => {
      const rec: NetworkRecord = {
        url: req.url(),
        method: req.method(),
        failureText: req.failure()?.errorText,
        timestamp: new Date().toISOString(),
      };
      this.failedRequests.push(rec);
      this.timeline.record("network_request", `request failed ${req.url()}`, {
        severity: "error",
        data: rec as unknown as Record<string, unknown>,
      });
    });

    this.page.on("response", (res) => {
      if (res.status() >= 400) {
        const rec: NetworkRecord = {
          url: res.url(),
          method: res.request().method(),
          status: res.status(),
          ok: false,
          timestamp: new Date().toISOString(),
        };
        this.failedRequests.push(rec);
        this.timeline.record("network_request", `response ${res.status()} ${res.url()}`, {
          severity: "warn",
          data: rec as unknown as Record<string, unknown>,
        });
      }
    });

    this.page.on("console", (msg) => {
      if (msg.type() === "error") {
        this.consoleErrors.push(msg.text());
        this.timeline.record("browser_console", msg.text(), {
          severity: "error",
        });
      }
    });

    this.page.on("pageerror", (err) => {
      this.consoleErrors.push(err.message);
      this.timeline.record("error", `pageerror ${err.message}`, {
        severity: "error",
      });
    });
  }
}
