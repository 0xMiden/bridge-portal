"use client";

import { type ReactNode, useRef, useState } from "react";
import { gsap, useGSAP } from "../../lib/gsap";
import { DUR, EASE, motionMM } from "../../lib/motion";

interface CollapseProps {
  show: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * Tier B. Animates a row's height (0 ↔ auto) + fade on show/hide so appearing
 * content (balance line, form errors, detail rows) never snaps and shoves its
 * neighbours (the CTA-shove). Exit-gated: stays mounted through the leave tween.
 */
export function Collapse({ show, children, className }: CollapseProps) {
  const [mounted, setMounted] = useState(show);
  const ref = useRef<HTMLDivElement>(null);

  if (show && !mounted) setMounted(true);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      motionMM(({ reduced }) => {
        gsap.killTweensOf(el);
        if (show) {
          if (reduced) {
            gsap.set(el, { height: "auto", autoAlpha: 1, clearProps: "height" });
            return;
          }
          gsap.fromTo(
            el,
            { height: 0, autoAlpha: 0 },
            {
              height: "auto",
              autoAlpha: 1,
              duration: DUR.enter,
              ease: EASE.standard,
              overwrite: true,
              // Release the fixed height so inner content can reflow freely.
              onComplete: () => gsap.set(el, { clearProps: "height" }),
            },
          );
          return;
        }
        if (reduced) {
          setMounted(false);
        } else {
          gsap.to(el, {
            height: 0,
            autoAlpha: 0,
            duration: DUR.exit,
            ease: EASE.exit,
            overwrite: true,
            onComplete: () => setMounted(false),
          });
        }
      });
    },
    { dependencies: [show, mounted], scope: ref },
  );

  if (!mounted) return null;
  return (
    <div ref={ref} className={className} style={{ overflow: "hidden" }}>
      {children}
    </div>
  );
}
