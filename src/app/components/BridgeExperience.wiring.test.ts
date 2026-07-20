import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./BridgeExperience.tsx", import.meta.url)),
  "utf8",
);

describe("BridgeExperience provider-selection wiring", () => {
  it("keeps token selection independent from route-menu focus restoration", () => {
    const tokenSelectHandlers = [
      ...source.matchAll(
        /<TokenSelect\b[\s\S]*?onSelectProvider=\{([A-Za-z0-9_]+)\}/g,
      ),
    ].map((match) => match[1]);

    expect(tokenSelectHandlers).toEqual(["selectProvider", "selectProvider"]);
    expect(source).toMatch(
      /className={`route-option[\s\S]*?onClick=\{\(\) => selectRouteOption\(key\)\}/,
    );
  });
});
