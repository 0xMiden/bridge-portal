import { beforeEach, describe, expect, it, vi } from "vitest";

import { AGGLAYER_BALI } from "./agglayer";
import { checkDeepHealth } from "./health";

function jsonRpc(result: string, status = 200): Response {
  return new Response(JSON.stringify({ result }), { status });
}

function http(status: number): Response {
  return new Response("", { status });
}

describe("checkDeepHealth", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("is ok when Sepolia chain id matches and the other three answer", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("ethereum-sepolia") || url.includes("publicnode")) {
        return jsonRpc(AGGLAYER_BALI.sepoliaChainHex);
      }
      return http(200);
    }) as unknown as typeof fetch;

    const result = await checkDeepHealth(fetchImpl);
    expect(result.ok).toBe(true);
    expect(result.checks.sepolia.ok).toBe(true);
    expect(result.checks.miden.ok).toBe(true);
    expect(result.checks.epoch.ok).toBe(true);
    expect(result.checks.agglayer.ok).toBe(true);
  });

  it("is 503-shaped when Sepolia is the wrong chain", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("publicnode") || url.includes("sepolia")) {
        return jsonRpc("0x1");
      }
      return http(200);
    }) as unknown as typeof fetch;

    const result = await checkDeepHealth(fetchImpl);
    expect(result.ok).toBe(false);
    expect(result.checks.sepolia.ok).toBe(false);
    expect(result.checks.sepolia.detail).toContain("0x1");
  });

  it("treats upstream 5xx as down and 404 as up", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("publicnode") || url.includes("sepolia")) {
        return jsonRpc(AGGLAYER_BALI.sepoliaChainHex);
      }
      if (url.includes("epochprotocol")) return http(404);
      if (url.includes("gateway.fm")) return http(502);
      return http(200);
    }) as unknown as typeof fetch;

    const result = await checkDeepHealth(fetchImpl);
    expect(result.ok).toBe(false);
    expect(result.checks.epoch.ok).toBe(true);
    expect(result.checks.agglayer.ok).toBe(false);
  });
});
