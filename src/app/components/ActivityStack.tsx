"use client";

import { ActivityRow, ActivitySection } from "./ActivityRow";
import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Activity } from "../lib/bridge-presentation";
import { gsap, standardEase } from "../lib/gsap";

/**
 * Recent transfers as an Apple-style notification stack: collapsed, the latest
 * transfer sits on top with the rest peeking behind it; a tap fans the whole
 * history open into a scrollable list, and "Show less" restacks it. A single
 * transfer needs no stack, so it renders as a plain row.
 */
export function ActivityStack({
  activities,
  title,
}: {
  activities: Activity[];
  title: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const prevHeight = useRef(0);
  const didMount = useRef(false);

  // Spring the section between its collapsed and expanded heights. Because the
  // card + history are a margin-auto centered group, animating this height makes
  // the whole component glide up/down as the list opens — the "move up springly"
  // feel — while the revealed rows stagger in. Plain useEffect (not useGSAP) so
  // we fully own cleanup: height/overflow are always cleared, otherwise the
  // section stays pinned and overflow:hidden would clip the peek cards.
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    const el = sectionRef.current;
    if (!el) return;
    const reset = () => {
      el.style.height = "";
      el.style.overflow = "";
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      reset();
      return;
    }

    gsap.killTweensOf(el);
    const target = el.offsetHeight;
    const tweens = [
      gsap.fromTo(
        el,
        { height: prevHeight.current || target, overflow: "hidden" },
        { height: target, duration: 0.5, ease: "back.out(1.2)" },
      ),
    ];
    if (expanded) {
      const rows = el.querySelectorAll(".home-activity-item");
      tweens.push(
        gsap.from(Array.from(rows).slice(1), {
          opacity: 0,
          y: -6,
          duration: 0.34,
          ease: standardEase,
          stagger: 0.045,
          delay: 0.06,
        }),
      );
    }
    // Guaranteed clear once the spring settles — height/overflow must never
    // linger (overflow:hidden would clip the collapsed stack's peek cards).
    const clearTimer = window.setTimeout(reset, 700);
    return () => {
      window.clearTimeout(clearTimer);
      tweens.forEach((t) => t.kill());
      reset();
    };
  }, [expanded]);

  const toggle = () => {
    prevHeight.current = sectionRef.current?.offsetHeight ?? 0;
    setExpanded((open) => !open);
  };

  if (activities.length === 0) return null;

  const [top] = activities;
  // Up to two ghost cards behind the top one — enough to read as a stack
  // without implying an exact count (the toggle carries the real number).
  const peek = Math.min(activities.length - 1, 2);

  return (
    <ActivitySection title={title} ref={sectionRef} action={activities.length > 1 && <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full bg-surface px-2.5 py-1 text-xs font-bold text-muted-foreground hover:text-foreground"
          aria-expanded={expanded}
          onClick={toggle}
        >
          {expanded ? "Show less" : `${activities.length} total`}
          <ChevronDown
            size={15}
            aria-hidden="true"
            className={expanded ? "rotate-180" : ""}
          />
        </button>}>

      {expanded || activities.length === 1 ? (
        <div className="grid gap-2">
          {activities.map((activity) => (
            <ActivityRow activity={activity} key={activity.id} />
          ))}
        </div>
      ) : (
        <button
          type="button"
          className="relative block w-full text-left"
          onClick={toggle}
          aria-label={`Show all ${activities.length} transfers`}
        >
          <ActivityRow activity={top} stacked />
          {Array.from({ length: peek }).map((_, i) => (
            <span
              key={i}
              className={`absolute rounded-lg bg-surface shadow-(--shadow-card)
                ${i === 0 ? "inset-x-2 top-2 -bottom-2 z-1 opacity-75" : "inset-x-4 top-4 -bottom-4 z-0 opacity-50"}`}
              aria-hidden="true"
            />
          ))}
        </button>
      )}
    </ActivitySection>
  );
}
