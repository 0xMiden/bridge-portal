import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const fixture = readFileSync(
  fileURLToPath(new URL("../../../../e2e/fixtures/bridge.ts", import.meta.url)),
  "utf8",
);

describe("e2e/fixtures/bridge.ts", () => {
  it("does not swallow waitForReady failures", () => {
    expect(fixture).toMatch(/await bridge\.waitForReady\(\)/);
    expect(fixture).not.toMatch(/waitForReady\(\)\.catch/);
  });
});
