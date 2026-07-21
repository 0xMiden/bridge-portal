"use client";

import { gsap, CustomEase } from "./gsap";

// House motion curves — the single source of truth for the app's "feel."
// Restrained & premium: calm Material-style easing, no overshoot except the one
// sanctioned celebratory curve. Defined as SVG paths (the cubic-bezier form
// CustomEase accepts): "M0,0 C<x1>,<y1> <x2>,<y2> 1,1".
export const EASE = {
  // cubic-bezier(0.4, 0, 0.2, 1) — replaces the old springy 0.16,1,0.3,1 "pop".
  standard: CustomEase.create("bridge-standard", "M0,0 C0.4,0 0.2,1 1,1"),
  // cubic-bezier(0.4, 0, 1, 1) — faster tail for exits (leave < enter).
  exit: CustomEase.create("bridge-exit", "M0,0 C0.4,0 1,1 1,1"),
  // cubic-bezier(0.2, 0, 0, 1) — = the CSS --ease-press, for press/interaction.
  emphasis: CustomEase.create("bridge-emphasis", "M0,0 C0.2,0 0,1 1,1"),
  // The ONLY sanctioned overshoot — celebratory moments only (e.g. success mark).
  overshoot: "back.out(1.4)",
} as const;

// Semantic durations (seconds). Exit is intentionally faster than enter.
export const DUR = {
  micro: 0.12, // press/hover (CSS usually owns these; mirrored for JS press)
  enter: 0.2, // Tier B enter (popover / collapse / crossfade in)
  exit: 0.15, // Tier B exit — faster than enter
  data: 0.45, // Tier C hero number tween
  flash: 0.3, // Tier C secondary color-flash / micro-crossfade
} as const;

// Travel distances (px). No scale-from-0 on data-carrying surfaces.
export const TRANSLATE = {
  pop: 6, // desktop popover slide
  sheet: 18, // mobile bottom-sheet slide
} as const;

// Global feel: bare gsap.to()/from() calls inherit the house curve + rhythm.
gsap.defaults({ ease: EASE.standard, duration: DUR.enter });

/**
 * Reduced-motion wrapper. Runs `build({ reduced })` under whichever
 * prefers-reduced-motion condition currently matches; GSAP reverts everything
 * created inside when the query flips or the enclosing context is cleaned up.
 * Call this INSIDE a useGSAP() callback so its context handles teardown.
 */
export function motionMM(build: (ctx: { reduced: boolean }) => void) {
  const mm = gsap.matchMedia();
  mm.add(
    {
      reduced: "(prefers-reduced-motion: reduce)",
      full: "(prefers-reduced-motion: no-preference)",
    },
    (context) => {
      build({ reduced: !!context.conditions?.reduced });
    },
  );
  return mm;
}

export { gsap };
