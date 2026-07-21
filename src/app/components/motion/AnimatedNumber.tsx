"use client";

import { useRef } from "react";
import { gsap, useGSAP } from "../../lib/gsap";
import { DUR, EASE, motionMM } from "../../lib/motion";

interface AnimatedNumberProps {
  value: number;
  /** Formats the (possibly fractional, mid-tween) value into display text. */
  format?: (n: number) => string;
  className?: string;
  /**
   * "hero": smooth count-up from the previous value (the "you receive" amount).
   * "flash": snap to the value with a brief accent color pulse (secondary
   * figures like fee / min-received). Reduced-motion → instant text either way.
   */
  mode?: "hero" | "flash";
  "aria-label"?: string;
}

/**
 * Tier C. A number that updates IN PLACE — tabular-nums freezes width so the
 * container never reflows/pops as digits change. React owns only the initial
 * (SSR) text; after mount GSAP owns textContent, so React never fights the tween.
 */
export function AnimatedNumber({
  value,
  format = (n) => String(n),
  className,
  mode = "hero",
  ...rest
}: AnimatedNumberProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const proxy = useRef({ v: value });
  // Captured once: React renders this for SSR/no-JS and never re-reconciles it,
  // leaving GSAP free to own textContent on every subsequent update.
  const initialText = useRef(format(value)).current;

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      motionMM(({ reduced }) => {
        if (reduced || mode === "flash") {
          el.textContent = format(value);
          proxy.current.v = value;
          if (!reduced && mode === "flash") {
            const base = getComputedStyle(el).color;
            gsap.fromTo(
              el,
              { color: "var(--accent, #ff5500)" },
              { color: base, duration: DUR.flash, ease: EASE.standard },
            );
          }
          return;
        }
        gsap.to(proxy.current, {
          v: value,
          duration: DUR.data,
          ease: EASE.standard,
          overwrite: true,
          onUpdate: () => {
            el.textContent = format(proxy.current.v);
          },
        });
      });
    },
    { dependencies: [value, mode], scope: ref },
  );

  return (
    <span
      ref={ref}
      className={className}
      style={{ fontVariantNumeric: "tabular-nums" }}
      {...rest}
    >
      {initialText}
    </span>
  );
}
