"use client";

import { useRef, useState } from "react";
import { gsap, useGSAP } from "../../lib/gsap";
import { DUR, EASE, TRANSLATE, motionMM } from "../../lib/motion";

export interface PopoverOptions {
  /** Mobile bottom-sheet variant: slides up from below, larger travel. */
  sheet?: boolean;
  /**
   * Keep the node in the DOM permanently and only animate visibility. Use for
   * surfaces that must stay queryable while closed (e.g. the EVM wallet menu the
   * theme e2e reads computed styles from). Default false = unmount after exit.
   */
  alwaysMounted?: boolean;
}

/**
 * One enter/exit contract for every popover/overlay. Fixes the app-wide bug
 * where menus animate open but blink shut (or snap open). Restrained feel:
 * translate + fade, no scale-pop, exit faster than enter, no fly-in on the first
 * closed render, re-open interrupts the leave tween cleanly. Reduced-motion via
 * motionMM. Returns { mounted, panelRef }; render `{mounted && <div ref=…>}`.
 */
export function usePopover(open: boolean, opts: PopoverOptions = {}) {
  const { sheet = false, alwaysMounted = false } = opts;
  const [mounted, setMounted] = useState(open || alwaysMounted);
  const panelRef = useRef<HTMLDivElement>(null);

  // Turn mount on synchronously when opening so the enter tween has a node.
  if (open && !mounted) setMounted(true);

  const travel = sheet ? TRANSLATE.sheet : TRANSLATE.pop;
  const fromY = sheet ? travel : -travel;
  const exitY = sheet ? travel : -travel * 0.5;

  useGSAP(
    () => {
      const el = panelRef.current;
      if (!el) return;
      motionMM(({ reduced }) => {
        gsap.killTweensOf(el);
        if (open) {
          if (reduced) {
            gsap.set(el, { autoAlpha: 1, y: 0 });
          } else {
            gsap.fromTo(
              el,
              { autoAlpha: 0, y: fromY },
              {
                autoAlpha: 1,
                y: 0,
                duration: DUR.enter,
                ease: EASE.standard,
                overwrite: true,
              },
            );
          }
          return;
        }
        // Closing.
        if (alwaysMounted) {
          if (reduced) gsap.set(el, { autoAlpha: 0 });
          else
            gsap.to(el, {
              autoAlpha: 0,
              y: exitY,
              duration: DUR.exit,
              ease: EASE.exit,
              overwrite: true,
            });
          return;
        }
        if (reduced) {
          setMounted(false);
        } else {
          gsap.to(el, {
            autoAlpha: 0,
            y: exitY,
            duration: DUR.exit,
            ease: EASE.exit,
            overwrite: true,
            onComplete: () => setMounted(false),
          });
        }
      });
    },
    { dependencies: [open, mounted], scope: panelRef },
  );

  return { mounted, panelRef };
}
