"use client";

import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  type Activity,
  activityStartedAt,
  providers,
  statusLabel,
  statusTone,
} from "../lib/bridge-state";
import { RelativeTime } from "./RelativeTime";
import { gsap } from "../lib/gsap";
import { EASE } from "../lib/motion";

function Row({ activity }: { activity: Activity }) {
  return (
    <>
      <span className={`status-dot ${statusTone(activity.status)}`} />
      <span className="activity-copy">
        <strong>{activity.summary}</strong>
        <small>
          {providers[activity.provider].label} - {statusLabel(activity.status)}
        </small>
      </span>
      <span className="activity-meta">
        <strong>
          {activity.amount} {activity.asset}
        </strong>
        <small>
          <RelativeTime at={activityStartedAt(activity)} />
        </small>
      </span>
      <ChevronRight size={16} aria-hidden="true" />
    </>
  );
}

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
          ease: EASE.standard,
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

  if (activities.length === 1) {
    return (
      <section className="home-activity" aria-label={title}>
        <div className="home-activity-title">
          <h2>{title}</h2>
        </div>
        <div className="home-activity-list">
          <Link className="home-activity-item" href={`/activity/${top.id}`}>
            <Row activity={top} />
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="home-activity" ref={sectionRef} aria-label={title}>
      <div className="home-activity-title">
        <h2>{title}</h2>
        <button
          type="button"
          className="activity-stack-toggle"
          aria-expanded={expanded}
          onClick={toggle}
        >
          {expanded ? "Show less" : `${activities.length} total`}
          <ChevronDown
            size={15}
            aria-hidden="true"
            className={expanded ? "is-open" : undefined}
          />
        </button>
      </div>

      {expanded ? (
        <div className="home-activity-list">
          {activities.map((activity) => (
            <Link
              className="home-activity-item"
              href={`/activity/${activity.id}`}
              key={activity.id}
            >
              <Row activity={activity} />
            </Link>
          ))}
        </div>
      ) : (
        <button
          type="button"
          className="activity-stack"
          onClick={toggle}
          aria-label={`Show all ${activities.length} transfers`}
        >
          <span className="home-activity-item activity-stack-top">
            <Row activity={top} />
          </span>
          {Array.from({ length: peek }).map((_, i) => (
            <span
              key={i}
              className="activity-stack-peek"
              style={{ ["--i" as string]: String(i + 1) }}
              aria-hidden="true"
            />
          ))}
        </button>
      )}
    </section>
  );
}
