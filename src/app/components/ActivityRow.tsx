import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { activityStartedAt } from "../../bridge/core/rules";
import { bridgeProviders } from "../../bridge/providers/registry";
import { type Activity, statusLabel, statusTone } from "../lib/bridge-presentation";
import { RelativeTime } from "./RelativeTime";
import { StatusIndicator } from "./ui/Status";

/** Current activity and history use the same heading and animated list surface. */
export function ActivitySection({ title, action, children, ...props }: ComponentProps<"section"> & { title: string; action?: ReactNode }) {
  return <section {...props} aria-label={title} className="w-full max-w-125">
    <div className="flex items-center justify-between px-1 pb-1">
      <h2 className="text-sm">{title}</h2>
      {action}
    </div>
    {children}
  </section>;
}

/** The same receipt summary appears in current activity, history, and the stack. */
export function ActivityRow({ activity, stacked = false }: { activity: Activity; stacked?: boolean }) {
  const classes = "home-activity-item relative z-2 flex items-center gap-3 rounded-lg bg-surface p-3 text-sm wrap-anywhere hover:bg-surface-muted";
  const content = <>
    <StatusIndicator variant="dot" tone={statusTone(activity.status, activity)} />
    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
      <ActivityText primary={activity.summary} secondary={`${bridgeProviders[activity.provider].label} - ${statusLabel(activity.status, activity)}`} />
      <ActivityText meta primary={`${activity.amount} ${activity.asset}`} secondary={<RelativeTime at={activityStartedAt(activity)} />} />
    </span>
    <ChevronRight size={16} aria-hidden="true" className="shrink-0" />
  </>;
  return stacked ? <span className={classes}>{content}</span>
    : <Link className={classes} href={`/activity/${encodeURIComponent(activity.id)}`}>{content}</Link>;
}

function ActivityText({ primary, secondary, meta = false }: { primary: ReactNode; secondary: ReactNode; meta?: boolean }) {
  return <span className={meta ? "ml-auto max-w-full text-right" : "min-w-0 flex-1 basis-40"}>
    <strong className="block">{primary}</strong>
    <small className="mt-1 block text-xs text-muted-foreground">{secondary}</small>
  </span>;
}
