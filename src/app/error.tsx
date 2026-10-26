"use client";

import { PageShell } from "./components/ui/PageLayout";
import { EmptyState } from "./components/ui/Feedback";
import { Button } from "./components/ui/Button";
import { useEffect } from "react";

// Route-level error boundary: a render/child error shows a graceful fallback
// with a retry instead of a blank page. Funds/wallets are unaffected — this is
// a UI-side recovery only.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <PageShell className="app-shell">
      <EmptyState>
        <h1>Something went wrong</h1>
        <p>
          The bridge hit an unexpected error. Your funds and wallet connections
          are unaffected — try again.
        </p>
        <Button variant="primary" className="primary-button mt-2.5" type="button" onClick={reset}>
          Try again
        </Button>
      </EmptyState>
    </PageShell>
  );
}
