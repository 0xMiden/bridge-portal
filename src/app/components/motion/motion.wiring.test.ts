import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Unit tier runs in the node env (no DOM/GSAP execution), so — matching the
// repo convention (BridgeExperience.wiring.test.ts) — assert the motion system's
// invariants at the source level. These contracts are what keep the animation
// system consistent and non-glitchy across every component.

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const PRIMITIVES = [
  "./usePopover.ts",
  "./AnimatedNumber.tsx",
  "./Collapse.tsx",
  "./Crossfade.tsx",
  "./useFlipSwap.ts",
];
const LIBS = ["../../lib/gsap.ts", "../../lib/motion.ts"];

describe("motion system wiring", () => {
  it("registers the plugins we depend on, once, in lib/gsap", () => {
    const gsapModule = read("../../lib/gsap.ts");
    expect(gsapModule).toMatch(/registerPlugin\([^)]*useGSAP[^)]*\)/);
    expect(gsapModule).toMatch(/Flip/);
    expect(gsapModule).toMatch(/CustomEase/);
  });

  it("keeps every motion file client-side", () => {
    for (const rel of [...LIBS, ...PRIMITIVES]) {
      expect(read(rel).startsWith('"use client"')).toBe(true);
    }
  });

  it("routes all GSAP imports through the central lib/gsap module", () => {
    // Only lib/gsap.ts may import directly from the "gsap" / "@gsap/react" pkgs.
    for (const rel of PRIMITIVES) {
      const src = read(rel);
      expect(src).not.toMatch(/from ["']gsap["']/);
      expect(src).not.toMatch(/from ["']gsap\//);
      expect(src).not.toMatch(/from ["']@gsap\/react["']/);
      expect(src).toMatch(/from ["']\.\.\/\.\.\/lib\/gsap["']/);
    }
  });

  it("gives every primitive a reduced-motion path (motionMM)", () => {
    for (const rel of PRIMITIVES) {
      expect(read(rel)).toMatch(/motionMM|reduced/);
    }
  });

  it("defines the semantic motion tokens as the single source of truth", () => {
    const motion = read("../../lib/motion.ts");
    for (const token of ["EASE", "DUR", "TRANSLATE", "motionMM"]) {
      expect(motion).toMatch(new RegExp(`export (const|function) ${token}`));
    }
    // Exits must be faster than enters.
    expect(motion).toMatch(/enter:\s*0\.2/);
    expect(motion).toMatch(/exit:\s*0\.15/);
    // gsap.defaults establishes the house feel globally.
    expect(motion).toMatch(/gsap\.defaults\(/);
  });

  it("freezes number width with tabular-nums", () => {
    expect(read("./AnimatedNumber.tsx")).toMatch(/tabular-nums/);
  });

  it("exit-gates unmount so popovers/collapse animate closed, not blink", () => {
    for (const rel of ["./usePopover.ts", "./Collapse.tsx"]) {
      const src = read(rel);
      expect(src).toMatch(/onComplete: \(\) => setMounted\(false\)/);
    }
  });
});
