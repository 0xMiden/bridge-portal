/**
 * Human "N ago" from a millisecond delta. Used for activity timestamps and the
 * detail-page monitor, so a row shows when it actually last changed instead of a
 * frozen "Just now".
 */
export function formatAgo(ms: number): string {
  if (ms < 3_000) return "just now";
  if (ms < 60_000) return `${Math.round(ms / 1_000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}
