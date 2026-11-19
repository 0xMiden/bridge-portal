// A wallet rejection is a normal user action, not a failure — detect it so the
// UI can show a short, friendly line instead of a raw multi-line SDK/viem dump.
export function isUserRejection(error: unknown): boolean {
  const fields = typeof error === "object" && error !== null ? error as { code?: unknown; message?: unknown } : {};
  if (fields.code === 4001 || fields.code === "ACTION_REJECTED") return true;
  const message = typeof fields.message === "string" ? fields.message : typeof error === "string" ? error : "";
  return /\b(?:user (?:has )?(?:rejected|denied|cancelled)|(?:rejected|denied|cancelled) by (?:the )?user|action_rejected)\b/i.test(message) ||
    /^denied transaction[.!]?$/i.test(message.trim());
}
