import { Card } from "../ui/Card";
import { ActivityRow, ActivitySection } from "../ActivityRow";
import { Button } from "../ui/Button";
import { useLayoutEffect, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import type { BridgeEnvironment } from "../../../config/environment";
import { useActivitySnapshot } from "../ActivityProvider";
import { ActivityStack } from "../ActivityStack";
import { useActivityNavigation } from "../ActivityNavigationProvider";

/** Keep both panels mounted so switching tabs preserves the transfer draft. */
export function BridgeTabs({ environment, children }: { environment: BridgeEnvironment; children: ReactNode }) {
  const params = useSearchParams();
  const activeTab = params.get("tab") === "activity" ? "activity" : "bridge";
  const { expanded, scrollY, setExpanded, rememberScroll } = useActivityNavigation(environment);
  const { receipts } = useActivitySnapshot();
  const activities = receipts.map(receipt => receipt.activity).filter(activity => activity.environment === environment);
  const inFlight = activities.filter(activity => activity.status !== "complete" && activity.status !== "failed" &&
    !(activity.status === "signature" && !activity.sourceTxHash));
  const past = activities.filter(activity => activity.status === "complete" || activity.status === "failed").slice(0, 12);

  useLayoutEffect(() => {
    if (activeTab === "activity" && scrollY !== null) {
      window.scrollTo({ top: scrollY, behavior: "instant" });
    }
  }, [activeTab, environment, scrollY]);

  function selectTab(tab: typeof activeTab) {
    if (activeTab === "activity") rememberScroll();
    const url = new URL(window.location.href);
    if (tab === "activity") url.searchParams.set("tab", tab);
    else url.searchParams.delete("tab");
    // Updating only the URL keeps the form and its draft mounted.
    window.history.replaceState(null, "", url);
  }

  function focusTab(tab: typeof activeTab) {
    selectTab(tab);
    document.getElementById(`${tab}-tab`)?.focus();
  }

  return (
    <>
      <div className="bridge-tabs flex w-full max-w-84 border-b-3 border-border" role="tablist" aria-label="Bridge portal">
        {(["bridge", "activity"] as const).map(tab => (
          <button className="relative min-h-12 flex-1 text-base text-muted-foreground aria-selected:font-semibold aria-selected:text-foreground
            aria-selected:after:absolute aria-selected:after:inset-x-0 aria-selected:after:-bottom-[3px] aria-selected:after:h-[3px] aria-selected:after:rounded-xs aria-selected:after:bg-foreground" key={tab} id={`${tab}-tab`} type="button" role="tab" aria-selected={activeTab === tab}
            aria-controls={`${tab}-panel`} tabIndex={activeTab === tab ? 0 : -1} onClick={() => selectTab(tab)}
            onKeyDown={event => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              focusTab(event.key === "Home" ? "bridge" : event.key === "End" ? "activity" : tab === "bridge" ? "activity" : "bridge");
            }}>
            {tab === "bridge" ? "Bridge" : "Activity"}
            {tab === "activity" && inFlight.length > 0 ? <span className="activity-count ml-2 inline-grid h-5 min-w-5 place-items-center rounded-full bg-accent-soft px-1 text-[11px] text-accent-foreground">{inFlight.length}</span> : null}
          </button>
        ))}
      </div>
      <div id="bridge-panel" role="tabpanel" aria-labelledby="bridge-tab" hidden={activeTab !== "bridge"} className="grid w-full grid-cols-1 gap-3 hidden:hidden">{children}</div>
      <div id="activity-panel" role="tabpanel" aria-labelledby="activity-tab" hidden={activeTab !== "activity"} className="activity-tab-panel w-full">
        <div className="activity-region grid w-full gap-3">
          {!inFlight.length && !past.length ? (
            <Card variant="empty">
              <h2 className="text-xl">No transfers yet</h2>
              <p className="mt-3 mb-6 text-muted-foreground">Your current and past transfers will appear here.</p>
              <Button variant="secondary" className="secondary-button" type="button" onClick={() => focusTab("bridge")}>Make a transfer</Button>
            </Card>
          ) : null}
          {inFlight.length > 0 ? (
            <ActivitySection title="Current transfer">
              <div className="grid gap-2">
                {inFlight.map(activity => (
                  <ActivityRow activity={activity} key={activity.id} onNavigate={rememberScroll} />
                ))}
              </div>
            </ActivitySection>
          ) : null}
          <ActivityStack activities={past} title="Recent transfers" expanded={expanded} onExpandedChange={setExpanded} onNavigate={rememberScroll} />
        </div>
      </div>
    </>
  );
}
