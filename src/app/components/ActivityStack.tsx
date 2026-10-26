"use client";

import { ActivityRow, ActivitySection } from "./ActivityRow";
import { ChevronDown } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import type { Activity } from "../lib/bridge-presentation";
import { animateWithMotionPreference, standardEase } from "../lib/motion";

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
  const prevHeight = useRef<number | null>(null);

  // Spring the section between its collapsed and expanded heights. Because the
  // card + history are a margin-auto centered group, animating this height makes
  // the whole component glide up/down as the list opens — the "move up springly"
  // feel — while the revealed rows stagger in. Measure before paint, after the
  // previous animation is canceled, so rapid toggles start at the visible height
  // and settle back to natural layout without clipping the peek cards.
  useLayoutEffect(() => {
    const start = prevHeight.current;
    prevHeight.current = null;
    const el = sectionRef.current;
    if (!el || start === null) return;
    const target = el.offsetHeight;
    return animateWithMotionPreference(() => {
      const animations = [el.animate(
        [{ height: `${start}px`, overflow: "hidden" }, { height: `${target}px`, overflow: "hidden" }],
        // The cubic curve preserves the original back-out overshoot of 1.2.
        { duration: 500, easing: "cubic-bezier(0.333333, 1.4, 0.666667, 1)" },
      )];
      if (expanded) {
        const rows = Array.from(el.querySelectorAll(".home-activity-item")).slice(1);
        animations.push(...rows.map((row, index) => row.animate(
          [{ opacity: 0, transform: "translateY(-6px)" }, { opacity: 1, transform: "none" }],
          { duration: 340, easing: standardEase, delay: 60 + index * 45, fill: "backwards" },
        )));
      }
      return animations;
    });
  }, [expanded]);

  const toggle = () => {
    prevHeight.current = sectionRef.current?.getBoundingClientRect().height ?? null;
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
