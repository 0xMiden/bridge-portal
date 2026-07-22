"use client";

import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import {
  type Activity,
  providers,
  statusLabel,
  statusTone,
} from "../lib/bridge-state";
import { RelativeTime } from "./RelativeTime";

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
          <RelativeTime at={activity.updatedAt} />
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
    <section className="home-activity" aria-label={title}>
      <div className="home-activity-title">
        <h2>{title}</h2>
        <button
          type="button"
          className="activity-stack-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
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
          onClick={() => setExpanded(true)}
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
