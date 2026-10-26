"use client";

// Single GSAP registration point. Every component imports gsap + plugins FROM
// HERE (never directly from "gsap") so registration is guaranteed to have run
// and webpack tree-shaking stays predictable. GSAP is free for commercial use
// (Webflow Standard License, 2025); core ~23KB gz, plugins imported individually.
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { CustomEase } from "gsap/CustomEase";

gsap.registerPlugin(useGSAP, CustomEase);

export { gsap, useGSAP, CustomEase };

export const standardEase = CustomEase.create("bridge-standard", "M0,0 C0.4,0 0.2,1 1,1");

/** Revert and rebuild motion when the user's reduced-motion preference changes. */
export function motionMM(build: (ctx: { reduced: boolean }) => void) {
  const mm = gsap.matchMedia();
  mm.add(
    { reduced: "(prefers-reduced-motion: reduce)", full: "(prefers-reduced-motion: no-preference)" },
    context => build({ reduced: !!context.conditions?.reduced }),
  );
  return mm;
}
