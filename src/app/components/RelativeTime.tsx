"use client";

import { useEffect, useState } from "react";
import { formatAgo } from "../lib/relative-time";

/**
 * Renders an epoch-ms timestamp as a live "N ago" that ticks on its own, so the
 * surrounding component doesn't re-render every second. `now` starts at 0 so SSR
 * and the first client render match (avoids a hydration mismatch); the effect
 * fills it in on mount. A missing/zero timestamp renders an em dash.
 */
export function RelativeTime({ at }: { at: number }) {
  const [now, setNow] = useState(0);

  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(id);
  }, []);

  if (!at || !now) return <>—</>;
  return <>{formatAgo(Math.max(0, now - at))}</>;
}
