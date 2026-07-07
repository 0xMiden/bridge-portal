"use client";

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
    <main className="app-shell">
      <section className="detail-empty">
        <h1>Something went wrong</h1>
        <p>
          The bridge hit an unexpected error. Your funds and wallet connections
          are unaffected — try again.
        </p>
        <button className="primary-button" type="button" onClick={reset}>
          Try again
        </button>
      </section>
    </main>
  );
}
