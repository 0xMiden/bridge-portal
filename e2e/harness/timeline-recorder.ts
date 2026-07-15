import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  EventCategory,
  EventSeverity,
  TimelineEvent,
} from "./types";

// One ordered, timestamped event stream per test, written as JSON Lines (§3.5).
export class TimelineRecorder {
  private readonly events: TimelineEvent[] = [];
  private readonly start = Date.now();
  private stepIndex = 0;
  private stepName = "setup";

  constructor(private readonly filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true });
  }

  setStep(index: number, name: string): void {
    this.stepIndex = index;
    this.stepName = name;
  }

  record(
    category: EventCategory,
    message: string,
    opts: {
      severity?: EventSeverity;
      data?: Record<string, unknown>;
      durationMs?: number;
    } = {},
  ): void {
    const event: TimelineEvent = {
      timestamp: new Date().toISOString(),
      elapsedMs: Date.now() - this.start,
      stepIndex: this.stepIndex,
      stepName: this.stepName,
      category,
      severity: opts.severity ?? "info",
      message,
      data: opts.data,
      durationMs: opts.durationMs,
    };
    this.events.push(event);
    try {
      appendFileSync(this.filePath, `${JSON.stringify(event)}\n`);
    } catch {
      // best-effort disk write; the in-memory list still feeds the report
    }
  }

  recent(n = 50): TimelineEvent[] {
    return this.events.slice(-n);
  }

  totalMs(): number {
    return Date.now() - this.start;
  }
}
