"use client";

import { type RefObject, useRef } from "react";
import { Flip, useGSAP } from "../../lib/gsap";
import { DUR, EASE, motionMM } from "../../lib/motion";

/**
 * Tier B — GSAP Flip layout transition (First-Last-Invert-Play). Use only when
 * elements genuinely relocate (e.g. From/To panels exchanging places); for a
 * plain relabel prefer <Crossfade>. Returns a `capture` fn: call it right before
 * the state mutation that moves the DOM; Flip.from then animates old → new once
 * React re-renders. `absolute:true` keeps flex/grid children from reflowing mid-tween.
 *
 *   const capture = useFlipSwap(scopeRef, ".swap-box", [mode]);
 *   onSwap: () => { capture(); setMode(next); }
 */
export function useFlipSwap(
  scope: RefObject<HTMLElement | null>,
  selector: string,
  dependencies: unknown[],
) {
  const stateRef = useRef<Flip.FlipState | null>(null);

  const { contextSafe } = useGSAP({ scope });

  const capture = contextSafe(() => {
    if (!scope.current) return;
    stateRef.current = Flip.getState(scope.current.querySelectorAll(selector));
  });

  // After the deps-driven re-render, play the captured state → new geometry.
  useGSAP(
    () => {
      if (!stateRef.current) return;
      motionMM(({ reduced }) => {
        if (reduced) {
          stateRef.current = null;
          return;
        }
        Flip.from(stateRef.current!, {
          duration: DUR.enter,
          ease: EASE.standard,
          absolute: true,
        });
        stateRef.current = null;
      });
    },
    { dependencies, scope },
  );

  return capture;
}
