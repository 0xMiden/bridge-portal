"use client";

import { useEffect } from "react";
import { isUserRejection } from "./errors";

// Some wallet SDKs surface a declined prompt as an unhandled promise rejection
// from an internal fire-and-forget task (our own await/try-catch already handles
// the user-facing path). In dev that pops Next's error overlay and blanks the
// page; in prod it's console noise. Swallow ONLY benign user-rejections here —
// real errors still propagate normally.
export function RejectionGuard() {
  useEffect(() => {
    function onRejection(event: PromiseRejectionEvent) {
      if (isUserRejection(event.reason)) event.preventDefault();
    }

    window.addEventListener("unhandledrejection", onRejection);
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, []);

  return null;
}
