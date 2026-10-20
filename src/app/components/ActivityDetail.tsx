"use client";

import { AlertTriangle, ArrowLeft, Check, Copy, RotateCcw, ShieldCheck, Wallet } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { shortAddress } from "../../wallets/identity";
import { type Activity, buildDiagnostics } from "../lib/bridge-presentation";
import { type ActivityDetailModel, activityDetailFor } from "../lib/activity-detail-presentation";
import { formatAgo } from "../lib/relative-time";
import { useActivityTracking } from "../lib/use-activity-tracking";
import { NetworkSelect } from "./NetworkSelect";
import { ThemeToggle } from "./ThemeToggle";
import { ActivityJourney } from "./ActivityJourney";

type Tracking = ReturnType<typeof useActivityTracking>;
type LoadedActivityProps = Pick<Tracking, "monitorError" | "lastCheckedAt" | "refresh"> & {
  activity: Activity;
};

export function ActivityDetail({ id }: { id: string }) {
  const tracking = useActivityTracking(id);
  return (
    <main className="detail-shell">
      <header className="detail-topbar">
        <Link className="brand" href="/" aria-label="Back to bridge">
          <Image src="/miden-logo-horizontal.svg" alt="Miden" width={112} height={34} priority />
          <span>Bridge</span>
        </Link>
        <div className="detail-topbar-actions">
          <NetworkSelect /><ThemeToggle />
          <Link className="back-link" href="/">
            <ArrowLeft size={17} aria-hidden="true" />
            New transfer
          </Link>
        </div>
      </header>
      {tracking.isLoading ? (
        <section className="detail-empty" role="status">Loading activity…</section>
      ) : tracking.activity ? (
        <LoadedActivity key={id} {...tracking} activity={tracking.activity} />
      ) : (
        <section className="detail-empty">
          <h1>Activity not found</h1>
          <p>This transfer isn&apos;t in local activity history on this browser.</p>
          <Link className="primary-button" href="/">Back to bridge</Link>
        </section>
      )}
    </main>
  );
}

function LoadedActivity({ activity, monitorError, lastCheckedAt, refresh }: LoadedActivityProps) {
  const model = activityDetailFor(activity);
  const needsClaim = model.progress.kind === "tracked" && model.progress.milestones.some((step) => step.status === "consume" && step.state === "current");
  return (
    <section className="detail-simple detail-journey">
      <p className="sr-only activity-status-announcement" role="status" aria-live="polite" aria-atomic="true">
        {model.announcement}
      </p>
      <ActivityJourney receipt={model.receipt} needsClaim={needsClaim}>
        <ActivityProgress progress={model.progress} lastCheckedAt={lastCheckedAt} refresh={refresh} claimGuidance={needsClaim ? model.guidance : null} />
        {model.guidance && !needsClaim && <ActivityGuidance guidance={model.guidance} />}
      </ActivityJourney>
      {monitorError && model.progress.kind === "tracked" && (
        <p className="form-error compact">{monitorError}</p>
      )}
      {model.canCopyDiagnostics && (
        <DiagnosticsButton activity={activity} monitorError={monitorError} lastCheckedAt={lastCheckedAt} />
      )}
    </section>
  );
}

function ActivityProgress({ progress, lastCheckedAt, refresh, claimGuidance }: {
  claimGuidance: ActivityDetailModel["guidance"];
  progress: ActivityDetailModel["progress"];
  lastCheckedAt: number;
  refresh: () => void;
}) {
  if (progress.kind === "manual") {
    return (
      <>
        <div className="steps-card"><p className="steps-note">{progress.message}</p></div>
        {progress.reference && (
          <div className="support-row">
            <p>{progress.reference.label}: <code title={progress.reference.value}>{shortAddress(progress.reference.value)}</code></p>
          </div>
        )}
      </>
    );
  }
  return (
    <>
      <div className="steps-card">
        <p className="steps-card-title">Bridge steps</p>
        <ol className="milestone-list">
          {progress.milestones.map((milestone, index) => (
            <li key={milestone.status} aria-current={milestone.state === "current" ? "step" : undefined} className={`milestone ${milestone.status === "consume" ? "consume " : ""}${milestone.state}`}>
              <span className="milestone-marker" aria-hidden="true">
                {milestone.status === "consume" ? <Wallet size={12} />
                  : milestone.state === "done" ? <Check size={12} />
                  : milestone.state === "failed" ? <AlertTriangle size={12} /> : index + 1}
              </span>
              <div className="milestone-copy">
                <strong>{milestone.label}</strong>
                {milestone.status === "consume" && claimGuidance ? <>
                  <span>{claimGuidance.body}</span>
                  {claimGuidance.steps && <ol className="journey-claim-steps">{claimGuidance.steps.map((step) => <li key={step}>{step}</li>)}</ol>}
                </> : (milestone.state === "current" || milestone.state === "failed" || milestone.status === "consume") && <span>{milestone.detail}</span>}
              </div>
            </li>
          ))}
        </ol>
        {progress.live && <LiveProgress lastCheckedAt={lastCheckedAt} deliveryWarningAt={progress.deliveryWarningAt} />}
      </div>
      {(progress.canRefresh || progress.midenBlock !== undefined) && (
        <div className="support-row">
          {progress.canRefresh && <button type="button" className="secondary-button" onClick={refresh}>Refresh status</button>}
          {progress.midenBlock !== undefined && <p>USDCx note included in Miden block {progress.midenBlock}.</p>}
        </div>
      )}
    </>
  );
}

/** The clock updates only live monitoring copy, not the receipt or route model. */
function LiveProgress({ lastCheckedAt, deliveryWarningAt }: {
  lastCheckedAt: number;
  deliveryWarningAt?: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const checked = lastCheckedAt ? formatAgo(Math.max(0, now - lastCheckedAt)) : "";
  return (
    <>
      <p className="steps-note">
        <ShieldCheck size={13} aria-hidden="true" />
        Safe to leave. Tracking resumes when you return.
        {checked ? ` Updated ${checked}.` : ""}
      </p>
      {deliveryWarningAt !== undefined && now > deliveryWarningAt && (
        <p className="steps-note">Still waiting for delivery. Keep this transaction hash and note ID; do not submit again.</p>
      )}
    </>
  );
}

function ActivityGuidance({ guidance }: { guidance: NonNullable<ActivityDetailModel["guidance"]> }) {
  const Icon = guidance.icon === "alert" ? AlertTriangle : Wallet;
  return (
    <div className={`action-panel ${guidance.tone}`}>
      <div className="action-panel-head">
        <Icon size={16} aria-hidden="true" />
        <strong>{guidance.title}</strong>
      </div>
      <p>{guidance.body}</p>
      {guidance.steps && <ol className="action-panel-steps">{guidance.steps.map((step) => <li key={step}>{step}</li>)}</ol>}
      {guidance.newTransfer && (
        <Link className="primary-button" href="/">
          <RotateCcw size={16} aria-hidden="true" />Start a new transfer
        </Link>
      )}
    </div>
  );
}

function DiagnosticsButton({ activity, monitorError, lastCheckedAt }: Omit<LoadedActivityProps, "refresh">) {
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
    <div className="support-row">
      <button type="button" className="secondary-button" onClick={copy} disabled={state === "copying"}>
        {state === "copied" ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
        {state === "copied" ? "Diagnostics copied" : state === "copying" ? "Copying…" : "Copy diagnostics"}
      </button>
      {state === "failed" && <p role="status">Could not copy diagnostics. Allow clipboard access and try again.</p>}
    </div>
  );
}
