import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/health", () => ({
  checkDeepHealth: vi.fn(),
}));

import { checkDeepHealth } from "../../lib/health";
import { GET } from "./route";

const deep = vi.mocked(checkDeepHealth);

describe("GET /health/deep", () => {
  beforeEach(() => {
    deep.mockReset();
  });

  it("returns 200 when every upstream is ok", async () => {
    deep.mockResolvedValue({
      ok: true,
      service: "miden-bridge-ui",
      checks: {
        sepolia: { ok: true, detail: "ok" },
        miden: { ok: true, detail: "ok" },
        epoch: { ok: true, detail: "ok" },
        agglayer: { ok: true, detail: "ok" },
      },
    });
    const res = await GET();
    expect(res.status).toBe(200);
  });

  it("returns 503 when any upstream is down", async () => {
    deep.mockResolvedValue({
      ok: false,
      service: "miden-bridge-ui",
      checks: {
        sepolia: { ok: false, detail: "timeout" },
        miden: { ok: true, detail: "ok" },
        epoch: { ok: true, detail: "ok" },
        agglayer: { ok: true, detail: "ok" },
      },
    });
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.checks.sepolia.ok).toBe(false);
  });
});
