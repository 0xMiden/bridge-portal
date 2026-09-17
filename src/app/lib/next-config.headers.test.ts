import { describe, expect, it } from "vitest";

import nextConfig from "../../../next.config";

describe("next.config.ts headers", () => {
  it("does not set COOP/COEP (see docs/decisions/wasm-threading-coop-coep.md)", async () => {
    const blocks = (await nextConfig.headers?.()) ?? [];
    const keys = blocks.flatMap((block) => block.headers.map((header) => header.key));
    expect(keys).not.toContain("Cross-Origin-Opener-Policy");
    expect(keys).not.toContain("Cross-Origin-Embedder-Policy");
    expect(keys).not.toContain("Cross-Origin-Resource-Policy");
  });

  it("restricts framing to same origin", async () => {
    const blocks = (await nextConfig.headers?.()) ?? [];
    const csp = blocks
      .flatMap((block) => block.headers)
      .find((header) => header.key === "Content-Security-Policy")?.value;
    expect(csp).toBe("frame-ancestors 'self'");
  });
});
