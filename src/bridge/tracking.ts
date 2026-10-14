import type { Activity } from "./core/models";
import { bridgeProviders } from "./providers/registry";

export async function observeActivity(activity: Activity, signal: AbortSignal) {
  const { flows } = await bridgeProviders[activity.provider].load();
  if (signal.aborted) return null;
  const monitor = flows[activity.mode].monitor;
  if (!monitor.canPoll(activity)) return null;
  const observation = await monitor.observe(activity, signal);
  if (signal.aborted) return null;
  // Merge only defined changes; never write back the snapshot used to poll.
  return {
    ...observation,
    patch: Object.fromEntries(
      Object.entries(observation.patch).filter(
        ([key, value]) => value !== undefined && value !== activity[key as keyof Activity],
      ),
    ) as Partial<Activity>,
  };
}
