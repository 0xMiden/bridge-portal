import type { TimelineRecorder } from "./timeline-recorder";
import type { StepSummary } from "./types";

// Named phases with timing + checkpoint recording (§3.5) so a failure report can
// say WHICH step failed and how long each took.
export class TestStepRunner {
  private readonly summary: StepSummary[] = [];
  private index = 0;
  private failedAt: { index: number; name: string } | undefined;

  constructor(private readonly timeline: TimelineRecorder) {}

  async step<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const index = this.index++;
    this.timeline.setStep(index, name);
    this.timeline.record("test_lifecycle", `step:start ${name}`);
    const start = Date.now();
    try {
      const result = await fn();
      const durationMs = Date.now() - start;
      this.summary.push({ index, name, status: "passed", durationMs });
      this.timeline.record("test_lifecycle", `step:pass ${name}`, { durationMs });
      return result;
    } catch (error) {
      const durationMs = Date.now() - start;
      this.summary.push({ index, name, status: "failed", durationMs });
      this.failedAt = { index, name };
      this.timeline.record("error", `step:fail ${name}`, {
        severity: "error",
        data: { message: (error as Error).message },
        durationMs,
      });
      throw error;
    }
  }

  getSummary(): StepSummary[] {
    return this.summary;
  }

  getFailedAt(): { index: number; name: string } | undefined {
    return this.failedAt;
  }
}
