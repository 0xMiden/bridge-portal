import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("GET /health", () => {
  it("is liveness-only", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, service: "miden-bridge-ui" });
  });
});
