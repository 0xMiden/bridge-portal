"use client";

import { useEffect } from "react";

// Some wallet SDKs surface a declined prompt as an unhandled promise rejection
// from an internal fire-and-forget task (our own await/try-catch already handles
// the user-facing path). In dev that pops Next's error overlay and blanks the
// page; in prod it's console noise. Swallow ONLY benign user-rejections here —
// real errors still propagate normally.
export function RejectionGuard() {
  useEffect(() => {
    function isUserRejection(reason: unknown): boolean {
      const code =
        typeof reason === "object" && reason !== null && "code" in reason
          ? (reason as { code?: unknown }).code
          : undefined;
      const message = (
        reason instanceof Error ? reason.message : String(reason ?? "")
      ).toLowerCase();
      return (
        code === 4001 ||
        message.includes("user rejected") ||
        message.includes("user denied") ||
        message.includes("denied transaction") ||
        message.includes("rejected the request")
      );
    }

    function onRejection(event: PromiseRejectionEvent) {
      if (isUserRejection(event.reason)) event.preventDefault();
    }

    window.addEventListener("unhandledrejection", onRejection);
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, []);

  return null;
}
