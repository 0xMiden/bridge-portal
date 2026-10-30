"use client";
import { useState } from "react";
import type { Activity } from "../../bridge/core/models";
import { useActivityStore } from "./ActivityProvider";
import { Button } from "./ui/Button";
import { FormAlert } from "./ui/Feedback";
import { manualObservationSchema } from "../../bridge/providers/xreserve/helper-types";

export function ManualHelperActions({ activity, refresh }: { activity: Activity; refresh: () => void }) {
  const store = useActivityStore(), helper = activity.cctpHelper;
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  if (!helper) return null;
  async function act(download: boolean) {
    setError(""); setBusy(true);
    try {
      const { resendManualHelper, validateBundleForActivity } = await import("../../bridge/providers/xreserve/helper-manual");
      const current = store.get(activity.id)?.activity;
      if (!current?.cctpHelper) throw new Error("Saved manual activity is unavailable.");
      if (!download) {
        await resendManualHelper(current, patch => {
          store.patch(current.id, patch);
          if (store.get(current.id)?.unsavedChanges) throw new Error("Could not save the existing signed transaction. Nothing was sent.");
        });
        refresh(); return;
      }
      const saved = current.cctpHelper;
      const response = await fetch(`/api/cctp-helper/manual/attestation?deploymentId=${encodeURIComponent(saved.authorization.deploymentId)}&sourceTransaction=${encodeURIComponent(saved.signature ?? "")}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Fresh manual-call validation is unavailable.");
      const observed = manualObservationSchema.parse(await response.json());
      if (observed.state !== "ready") throw new Error("The manual call is not currently validated. Refresh status before exporting.");
      const bundle = validateBundleForActivity(observed.bundle, saved);
      const href = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = href; link.download = `miden-manual-arc-${saved.attemptId}.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch (cause) {
      if (download) {
        const saved = store.get(activity.id)?.activity.cctpHelper;
        if (saved) store.patch(activity.id, { cctpHelper: { ...saved, stage: "needs_attention", reason: "Fresh manual-call validation is unavailable." } });
      }
      setError(cause instanceof Error ? cause.message : "Manual operation unavailable.");
    }
    finally { setBusy(false); }
  }
  return <div className="mt-5 grid gap-3 rounded-lg border border-border p-4 text-sm">
    <p>Deployment: <code>{helper.authorization.deploymentId}</code></p>
    <p>Recipient: <code className="break-all">{activity.midenAccount}</code></p>
    {helper.reason && <p role="status">Observation: {helper.reason.replaceAll("_", " ")}. Keep this attempt; do not burn again.</p>}
    <Button type="button" variant="secondary" disabled={busy} onClick={refresh}>Refresh status</Button>
    {helper.signedBytes && <Button type="button" variant="secondary" disabled={busy} onClick={() => void act(false)}>Retry saved source transaction</Button>}
    {helper.stage === "ready" && <Button type="button" variant="primary" disabled={busy} onClick={() => void act(true)}>Download manual Arc call</Button>}
    {error && <FormAlert role="alert">{error}</FormAlert>}
  </div>;
}
