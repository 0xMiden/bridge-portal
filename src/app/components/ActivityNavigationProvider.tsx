"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import type { BridgeEnvironment } from "../../config/environment";

type ActivityView = { expanded: boolean; scrollY: number | null };
type ActivityViews = Partial<Record<BridgeEnvironment, ActivityView>>;
const emptyView: ActivityView = { expanded: false, scrollY: null };
const ActivityNavigationContext = createContext<{
  views: ActivityViews;
  updateView: (environment: BridgeEnvironment, patch: Partial<ActivityView>) => void;
} | null>(null);

/** List position belongs to the session, so receipt routes can restore it. */
export function ActivityNavigationProvider({ children }: { children: ReactNode }) {
  const [views, setViews] = useState<ActivityViews>({});
  const updateView = useCallback((environment: BridgeEnvironment, patch: Partial<ActivityView>) => {
    setViews(previous => ({
      ...previous,
      [environment]: { ...(previous[environment] ?? emptyView), ...patch },
    }));
  }, []);
  return <ActivityNavigationContext value={{ views, updateView }}>{children}</ActivityNavigationContext>;
}

export function useActivityNavigation(environment: BridgeEnvironment) {
  const navigation = useContext(ActivityNavigationContext);
  if (!navigation) throw new Error("Activity navigation requires ActivityNavigationProvider");
  return {
    ...(navigation.views[environment] ?? emptyView),
    rememberScroll: () => navigation.updateView(environment, { scrollY: window.scrollY }),
    setExpanded: (expanded: boolean) => navigation.updateView(environment, { expanded }),
  };
}
