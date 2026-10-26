// A wallet rejection is a normal user action, not a failure — detect it so the
// UI can show a short, friendly line instead of a raw multi-line SDK/viem dump.
export function isUserRejection(error: unknown): boolean {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 4001
  ) {
    return true;
  }
  const message = (
    error instanceof Error ? error.message : String(error ?? "")
  ).toLowerCase();
  return (
    message.includes("user rejected") ||
    message.includes("user denied") ||
    message.includes("denied transaction") ||
    message.includes("rejected the request") ||
    message.includes("action_rejected")
  );
}
