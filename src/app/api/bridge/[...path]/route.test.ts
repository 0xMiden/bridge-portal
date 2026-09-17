import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { GET } from "./route";

describe("GET /api/bridge/*", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns 502 when the upstream bridge API is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connect ECONNREFUSED");
      }),
    );

    const res = await GET(
      new NextRequest("http://localhost/api/bridge/health"),
      { params: Promise.resolve({ path: ["health"] }) },
    );
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.message).toBe("Bridge API is unavailable");
  });

  it("forwards a successful upstream GET, stripping hop-by-hop headers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        expect(String(url)).toContain("/health");
        return new Response("ok", {
          status: 200,
          headers: {
            "content-type": "text/plain",
            connection: "keep-alive",
          },
        });
      }),
    );

    const res = await GET(
      new NextRequest("http://localhost/api/bridge/health"),
      { params: Promise.resolve({ path: ["health"] }) },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("connection")).toBeNull();
    expect(await res.text()).toBe("ok");
  });
});
