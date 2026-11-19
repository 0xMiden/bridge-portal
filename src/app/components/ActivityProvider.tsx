"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { ActivityStore } from "../../bridge/activity";
import { activityPersistence, isActivityStorageEvent } from "../lib/bridge-persistence";

const ActivityContext = createContext<ActivityStore | null>(null);

export function ActivityProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => new ActivityStore(activityPersistence));
  useEffect(() => {
    store.sync();
    const onStorage = (event: StorageEvent) => {
      if (isActivityStorageEvent(event.key)) store.sync();
    };
    window.addEventListener("storage", onStorage);
    const onFocus = () => { void store.sync(); };
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
    };
  }, [store]);
  return <ActivityContext.Provider value={store}>{children}</ActivityContext.Provider>;
}

export function useActivityStore() {
  const store = useContext(ActivityContext);
  if (!store) throw new Error("Activity hooks require ActivityProvider");
  return store;
}

export function useActivitySnapshot() {
  const store = useActivityStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
