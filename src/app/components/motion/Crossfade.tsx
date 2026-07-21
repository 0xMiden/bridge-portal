"use client";

import { type ReactNode, useRef, useState } from "react";
import { gsap, useGSAP } from "../../lib/gsap";
import { DUR, EASE, motionMM } from "../../lib/motion";

interface CrossfadeProps {
  /** Identity of the current content. When it changes, the content cross-fades. */
  token: string | number;
  children: ReactNode;
  className?: string;
}

/**
 * Tier B. Swaps content WITHIN A FIXED FRAME (mode="wait"): fade the old out,
 * then fade the new in — no fly-in on first mount. The in-place replacement for
 * the key-based remounts (From/To labels, route/token switch) and for the
 * quote's loading↔amount↔error states, so the layout stays put while text changes.
 * The parent must give the frame a stable size (min-height / tabular-nums).
 */
export function Crossfade({ token, children, className }: CrossfadeProps) {
  const [displayed, setDisplayed] = useState<{
    token: string | number;
    node: ReactNode;
  }>({ token, node: children });
  const ref = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  // Always hold the newest incoming content so a rapid second change wins.
  const latest = useRef<{ token: string | number; node: ReactNode }>({
    token,
    node: children,
  });
  latest.current = { token, node: children };

  // Fade the current content OUT when the incoming token differs, then swap.
  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      if (token === displayed.token) return;
      motionMM(({ reduced }) => {
        if (reduced) {
          setDisplayed(latest.current);
          return;
        }
        gsap.killTweensOf(el);
        gsap.to(el, {
          autoAlpha: 0,
          y: 2,
          duration: DUR.exit,
          ease: EASE.exit,
          overwrite: true,
          onComplete: () => setDisplayed(latest.current),
        });
      });
    },
    { dependencies: [token], scope: ref },
  );

  // Fade the NEW content in once it's displayed (skip the very first mount).
  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      if (first.current) {
        first.current = false;
        gsap.set(el, { autoAlpha: 1, y: 0 });
        return;
      }
      motionMM(({ reduced }) => {
        if (reduced) {
          gsap.set(el, { autoAlpha: 1, y: 0 });
          return;
        }
        gsap.fromTo(
          el,
          { autoAlpha: 0, y: -2 },
          {
            autoAlpha: 1,
            y: 0,
            duration: DUR.enter,
            ease: EASE.standard,
            overwrite: true,
          },
        );
      });
    },
    { dependencies: [displayed.token], scope: ref },
  );

  return (
    <div ref={ref} className={className}>
      {displayed.node}
    </div>
  );
}
