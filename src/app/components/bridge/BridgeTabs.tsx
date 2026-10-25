import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { activityStartedAt } from "../../../bridge/core/rules";
import { bridgeProviders } from "../../../bridge/providers/registry";
import type { BridgeEnvironment } from "../../../config/environment";
import { statusLabel, statusTone } from "../../lib/bridge-presentation";
import { useActivitySnapshot } from "../ActivityProvider";
import { ActivityStack } from "../ActivityStack";
import { RelativeTime } from "../RelativeTime";

/** Keep both panels mounted so switching tabs preserves the transfer draft. */
export function BridgeTabs({ environment, children }: { environment: BridgeEnvironment; children: ReactNode }) {
  const [activeTab, setActiveTab] = useState<"bridge" | "activity">("bridge");
  const { receipts } = useActivitySnapshot();
  const activities = receipts.map(receipt => receipt.activity).filter(activity => activity.environment === environment);
  const inFlight = activities.filter(activity => activity.status !== "complete" && activity.status !== "failed" &&
    !(activity.status === "signature" && !activity.sourceTxHash));
  const past = activities.filter(activity => activity.status === "complete" || activity.status === "failed").slice(0, 12);

  function focusTab(tab: typeof activeTab) {
    setActiveTab(tab);
    document.getElementById(`${tab}-tab`)?.focus();
  }

  return (
    <>
      <div className="bridge-tabs" role="tablist" aria-label="Bridge portal">
        {(["bridge", "activity"] as const).map(tab => (
          <button key={tab} id={`${tab}-tab`} type="button" role="tab" aria-selected={activeTab === tab}
            aria-controls={`${tab}-panel`} tabIndex={activeTab === tab ? 0 : -1} onClick={() => setActiveTab(tab)}
            onKeyDown={event => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              focusTab(event.key === "Home" ? "bridge" : event.key === "End" ? "activity" : tab === "bridge" ? "activity" : "bridge");
            }}>
            {tab === "bridge" ? "Bridge" : "Activity"}
            {tab === "activity" && inFlight.length > 0 ? <span className="activity-count">{inFlight.length}</span> : null}
          </button>
        ))}
      </div>
      <div id="bridge-panel" role="tabpanel" aria-labelledby="bridge-tab" hidden={activeTab !== "bridge"} className="bridge-tab-panel">{children}</div>
      <div id="activity-panel" role="tabpanel" aria-labelledby="activity-tab" hidden={activeTab !== "activity"} className="activity-tab-panel">
        <div className="activity-region">
          {!inFlight.length && !past.length ? (
            <div className="activity-empty">
              <h2>No transfers yet</h2>
              <p>Your current and past transfers will appear here.</p>
              <button className="secondary-button" type="button" onClick={() => focusTab("bridge")}>Make a transfer</button>
            </div>
          ) : null}
          {inFlight.length > 0 ? (
            <section className="home-activity" aria-label="Current transfer">
              <div className="home-activity-title"><h2>Current transfer</h2></div>
              <div className="home-activity-list">
                {inFlight.map(activity => (
                  <Link className="home-activity-item" href={`/activity/${encodeURIComponent(activity.id)}`} key={activity.id}>
                    <span className={`status-dot ${statusTone(activity.status, activity)}`} />
                    <span className="activity-copy">
                      <strong>{activity.summary}</strong>
                      <small>{bridgeProviders[activity.provider].label} - {statusLabel(activity.status, activity)}</small>
                    </span>
                    <span className="activity-meta">
                      <strong>{activity.amount} {activity.asset}</strong>
                      <small><RelativeTime at={activityStartedAt(activity)} /></small>
                    </span>
                    <ChevronRight size={16} aria-hidden="true" />
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
          <ActivityStack activities={past} title="Recent transfers" />
        </div>
      </div>
    </>
  );
}
