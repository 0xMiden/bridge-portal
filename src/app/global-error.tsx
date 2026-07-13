"use client";

import { useEffect } from "react";

// Last-resort boundary for errors thrown in the root layout itself. Must render
// its own <html>/<body> because it replaces the whole document tree.
export default function GlobalError({
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
    <html lang="en">
      <body
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#f7f4ee",
          color: "#171511",
        }}
      >
        <main style={{ textAlign: "center", padding: 24 }}>
          <h1>Something went wrong</h1>
          <p style={{ color: "#706b61" }}>The app hit an unexpected error.</p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 12,
              padding: "10px 18px",
              borderRadius: 12,
              border: 0,
              background: "#171511",
              color: "#fff",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </main>
      </body>
    </html>
  );
}
