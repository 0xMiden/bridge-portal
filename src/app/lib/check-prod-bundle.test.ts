import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const scanner = resolve("scripts/check-prod-bundle.mjs");

function scan(source: string) {
  const cwd = mkdtempSync(join(tmpdir(), "bridge-prod-scan-"));
  try {
    const output = join(cwd, ".open-next/server-functions/default");
    mkdirSync(output, { recursive: true });
    writeFileSync(join(output, "handler.mjs"), source);
    return spawnSync(process.execPath, [scanner], { cwd, encoding: "utf8" });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

describe("production bundle scanner", () => {
  it.each([
    'process.env.NEXT_PUBLIC_E2E_TEST === "true"',
    'process.env.NEXT_PUBLIC_E2E_TEST=="true"',
    '"true" === process.env.NEXT_PUBLIC_E2E_TEST',
    'process.env.NEXT_PUBLIC_E2E_TEST = "false"',
  ])("allows an inactive flag or runtime comparison: %s", (source) => {
    const result = scan(source);
    expect(result.status, result.stderr).toBe(0);
  });

  it.each([
    'process.env.NEXT_PUBLIC_E2E_TEST = "true"',
    'const config = { NEXT_PUBLIC_E2E_TEST: true };',
    '{"NEXT_PUBLIC_E2E_TEST":"true"}',
  ])("rejects an enabled test flag: %s", (source) => {
    const result = scan(source);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("NEXT_PUBLIC_E2E_TEST inlined true");
  });

  it.each([
    ["NEXT_PUBLIC_E2E_EVM_PRIVATE_KEY", "E2E EVM private key inlined"],
    ["NEXT_PUBLIC_E2E_MIDEN_SEED", "E2E Miden seed inlined"],
  ])("still rejects embedded test credentials: %s", (key, message) => {
    const result = scan(JSON.stringify({ [key]: `0x${"1".repeat(64)}` }));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(message);
  });
});
