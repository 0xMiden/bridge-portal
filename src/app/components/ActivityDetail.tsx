"use client";

import { EmptyState, FormAlert } from "./ui/Feedback";

import { Button, ButtonAnchor, ButtonLink } from "./ui/Button";
import { AlertTriangle, ArrowLeft, Check, Copy, Plus, RotateCcw, ShieldCheck, Wallet } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { shortAddress } from "../../wallets/identity";
import { type Activity, buildDiagnostics } from "../lib/bridge-presentation";
import { type ActivityDetailModel, activityDetailFor } from "../lib/activity-detail-presentation";
import { formatAgo } from "../lib/relative-time";
import { useActivityTracking } from "../lib/use-activity-tracking";
import { useBridgeEnvironment, useSelectBridgeEnvironment } from "./NetworkProvider";
import { ActivityJourney } from "./ActivityJourney";
import { ManualHelperActions } from "./ManualHelperActions";

type Tracking = ReturnType<typeof useActivityTracking>;
type LoadedActivityProps = Pick<Tracking, "monitorError" | "lastCheckedAt" | "refresh" | "receiptSaved"> & {
  activity: Activity;
};

export function ActivityDetail({ id }: { id: string }) {
  const tracking = useActivityTracking(id);
  const environment = useBridgeEnvironment();
  const selectEnvironment = useSelectBridgeEnvironment();
  return (
    <div className="detail-shell mx-auto mt-6 w-full max-w-137 pb-10 mobile:mt-4">
      <nav aria-label="Activity navigation" className="mb-3 flex items-center justify-between gap-4 text-sm text-muted-foreground">
        <Link className="inline-flex min-h-11 items-center gap-1.5 rounded-sm hover:text-foreground hover:underline underline-offset-4"
          href="/?tab=activity" scroll={false} onNavigate={() => selectEnvironment(environment)}>
          <ArrowLeft size={16} aria-hidden="true" />Activity
        </Link>
        <Link className="inline-flex min-h-11 items-center gap-1.5 rounded-sm hover:text-foreground hover:underline underline-offset-4" href="/">
          New transfer<Plus size={16} aria-hidden="true" />
        </Link>
      </nav>
      {tracking.isLoading ? (
        <EmptyState role="status">Loading activity…</EmptyState>
      ) : tracking.activity ? (
        <LoadedActivity key={id} {...tracking} activity={tracking.activity} />
      ) : (
        <EmptyState>
          <h1>Activity not found</h1>
          <p>This transfer isn&apos;t in local activity history on this browser.</p>
          <ButtonLink className="primary-button mt-2.5" href="/">Back to bridge</ButtonLink>
        </EmptyState>
      )}
    </div>
  );
}

function LoadedActivity({ activity, monitorError, lastCheckedAt, refresh, receiptSaved }: LoadedActivityProps) {
  const model = activityDetailFor(activity);
  const needsClaim = model.progress.kind === "tracked" && model.progress.milestones.some((step) => step.status === "consume" && step.state === "current");
  return (
    <section className="detail-simple">
      <p className="sr-only activity-status-announcement" role="status" aria-live="polite" aria-atomic="true">
        {model.announcement}
      </p>
      {!receiptSaved && (
        <ActivityNotice role="alert">
          <p>This receipt could not be saved in your browser. Download it before refreshing or closing this tab. Do not submit the transfer again.</p>
          <ButtonAnchor variant="secondary" className="secondary-button" download={`miden-bridge-${activity.id}.json`}
            href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(activity.cctpHelper ? buildDiagnostics(activity) : activity, null, 2))}`}>
            Download receipt
          </ButtonAnchor>
        </ActivityNotice>
      )}
      <ActivityJourney receipt={model.receipt} needsClaim={needsClaim}>
        <ActivityProgress progress={model.progress} lastCheckedAt={lastCheckedAt} refresh={refresh} receiptSaved={receiptSaved} claimGuidance={needsClaim ? model.guidance : null} />
        {model.guidance && !needsClaim && <ActivityGuidance guidance={model.guidance} />}
      </ActivityJourney>
      {activity.cctpHelper && <ManualHelperActions activity={activity} refresh={refresh} />}
      {monitorError && model.progress.kind === "tracked" && (
        <FormAlert compact>{monitorError}</FormAlert>
      )}
      {model.canCopyDiagnostics && (
        <DiagnosticsButton activity={activity} monitorError={monitorError} lastCheckedAt={lastCheckedAt} />
      )}
    </section>
  );
}

function ActivityProgress({ progress, lastCheckedAt, refresh, claimGuidance, receiptSaved }: {
  claimGuidance: ActivityDetailModel["guidance"];
  progress: ActivityDetailModel["progress"];
  lastCheckedAt: number;
  refresh: () => void;
  receiptSaved: boolean;
}) {
  if (progress.kind === "manual") {
    return (
      <>
        <div className="grid gap-5 border-t border-border pt-6"><ProgressNote>{progress.message}</ProgressNote></div>
        {progress.reference && (
          <div className="mt-4.5 flex justify-end">
            <p>{progress.reference.label}: <code title={progress.reference.value}>{shortAddress(progress.reference.value)}</code></p>
          </div>
        )}
      </>
    );
  }
  return (
    <>
      <div className="grid gap-5 border-t border-border pt-6">
        <p className="sr-only">Bridge steps</p>
        <ol className="grid">
          {progress.milestones.map((milestone, index) => (
            <ProgressStep key={milestone.status} step={milestone} index={index} claimGuidance={claimGuidance} />
          ))}
        </ol>
        {progress.live && <LiveProgress lastCheckedAt={lastCheckedAt} deliveryWarningAt={progress.deliveryWarningAt} receiptSaved={receiptSaved} />}
      </div>
      {(progress.canRefresh || progress.midenBlock !== undefined) && (
        <div className="mt-4.5 flex justify-end">
          {progress.canRefresh && <Button type="button" variant="secondary" className="secondary-button" onClick={refresh}>Refresh status</Button>}
          {progress.midenBlock !== undefined && <p>USDCx note included in Miden block {progress.midenBlock}.</p>}
        </div>
      )}
    </>
  );
}

/** The clock updates only live monitoring copy, not the receipt or route model. */
function LiveProgress({ lastCheckedAt, deliveryWarningAt, receiptSaved }: {
  lastCheckedAt: number;
  deliveryWarningAt?: number;
  receiptSaved: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const checked = lastCheckedAt ? formatAgo(Math.max(0, now - lastCheckedAt)) : "";
  return (
    <>
      <ProgressNote>
        <ShieldCheck className="mt-px flex-none" size={13} aria-hidden="true" />
        {receiptSaved ? "Safe to leave. Tracking resumes when you return." : "Keep this tab open to continue tracking."}
        {checked ? ` Updated ${checked}.` : ""}
      </ProgressNote>
      {deliveryWarningAt !== undefined && now > deliveryWarningAt && (
        <ProgressNote>Still waiting for delivery. Keep this transaction hash and note ID; do not submit again.</ProgressNote>
      )}
    </>
  );
}

function ActivityGuidance({ guidance }: { guidance: NonNullable<ActivityDetailModel["guidance"]> }) {
  const Icon = guidance.icon === "alert" ? AlertTriangle : Wallet;
  return (
    <ActivityNotice>
      <div className="flex items-center gap-2 text-sm">
        <Icon className={guidance.tone === "danger" ? "shrink-0 text-danger-foreground" : guidance.tone === "success" ? "shrink-0 text-success-foreground" : "shrink-0"} size={16} aria-hidden="true" />
        <strong>{guidance.title}</strong>
      </div>
      <p>{guidance.body}</p>
      {guidance.steps && <ol className="action-panel-steps space-y-1 pl-4 text-xs text-muted-foreground">{guidance.steps.map((step) => <li key={step}>{step}</li>)}</ol>}
      {guidance.newTransfer && (
        <ButtonLink className="primary-button mt-1" href="/">
          <RotateCcw size={16} aria-hidden="true" />Start a new transfer
        </ButtonLink>
      )}
    </ActivityNotice>
  );
}

function DiagnosticsButton({ activity, monitorError, lastCheckedAt }: Pick<LoadedActivityProps, "activity" | "monitorError" | "lastCheckedAt">) {
  const [state, setState] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const request = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    request.current++;
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);

  async function copy() {
    const currentRequest = ++request.current;
    if (timer.current !== null) clearTimeout(timer.current);
    setState("copying");
    try {
      await navigator.clipboard.writeText(JSON.stringify(buildDiagnostics(activity, { monitorError, lastCheckedAt }), null, 2));
      if (currentRequest !== request.current) return;
      setState("copied");
      timer.current = setTimeout(() => setState("idle"), 2_000);
    } catch {
      if (currentRequest === request.current) setState("failed");
    }
  }

  return (
    <div className="mt-4 flex justify-end">
      <Button type="button" variant="secondary" className="secondary-button" onClick={copy} disabled={state === "copying"}>
        {state === "copied" ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
        {state === "copied" ? "Diagnostics copied" : state === "copying" ? "Copying…" : "Copy diagnostics"}
      </Button>
      {state === "failed" && <p role="status">Could not copy diagnostics. Allow clipboard access and try again.</p>}
    </div>
  );
}

function ActivityNotice(props: ComponentProps<"div">) {
  return <div {...props} className="mt-6 grid gap-2 rounded-lg bg-surface p-5 text-sm shadow-(--shadow-card)" />;
}

function ProgressNote({ children }: { children: ReactNode }) {
  return <p className="flex items-start gap-2 text-xs text-muted-foreground">{children}</p>;
}

type Step = Extract<ActivityDetailModel["progress"], { kind: "tracked" }>["milestones"][number];

function ProgressStep({ step, index, claimGuidance }: { step: Step; index: number; claimGuidance: ActivityDetailModel["guidance"] }) {
  const markerColors = {
    unknown: "border-border-strong bg-surface text-muted-foreground",
    upcoming: "border-border-strong bg-surface text-muted-foreground",
    done: "border-success-foreground bg-surface text-success-foreground",
    failed: "border-danger bg-danger text-on-status",
    current: step.status === "consume" ? "border-accent bg-accent text-surface"
      : "border-accent-foreground bg-accent-foreground text-surface motion-safe:animate-status-pulse",
  };
  const labelColor = step.state === "current" ? "text-accent-foreground" : step.state === "upcoming" ? "text-muted-foreground" : "text-foreground";
  return <li className={`milestone group/step relative flex gap-3 pb-6 last:pb-0 ${step.state}`}
    aria-current={step.state === "current" ? "step" : undefined}>
    <span className={`absolute top-6 bottom-1 left-2.5 w-px group-last/step:hidden ${step.state === "done" ? "bg-success" : "bg-border-strong"}`} aria-hidden="true" />
    <span className={`grid size-5 shrink-0 place-items-center rounded-full border-2 text-xs ${markerColors[step.state]}`} aria-hidden="true">
      {step.status === "consume" ? <Wallet size={12} /> : step.state === "done" ? <Check size={12} />
        : step.state === "failed" ? <AlertTriangle size={12} /> : index + 1}
    </span>
    <div className="min-w-0 space-y-1 text-xs text-muted-foreground">
      <strong className={`block text-sm font-medium ${labelColor}`}>{step.label}</strong>
      {step.status === "consume" && claimGuidance ? <>
        <span className="block">{claimGuidance.body}</span>
        {claimGuidance.steps && <ol className="list-decimal pl-4 text-muted-foreground">{claimGuidance.steps.map(item => <li key={item}>{item}</li>)}</ol>}
      </> : (step.state === "current" || step.state === "failed" || step.status === "consume") && (
        <span className="block">{step.detail}</span>
      )}
    </div>
  </li>;
}
