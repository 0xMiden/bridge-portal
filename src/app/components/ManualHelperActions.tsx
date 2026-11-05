"use client";
import { useState } from "react";
import type { Activity } from "../../bridge/core/models";
import { useActivityStore } from "./ActivityProvider";
import { Button } from "./ui/Button";
import { FormAlert } from "./ui/Feedback";
import { evmNetworks } from "../../config/evm-networks";
import { withHelperJournalUpdate } from "../../bridge/providers/xreserve/helper-submission-lock";
import { manualHelperDirection } from "../../bridge/providers/xreserve/helper-provider";
import { MANUAL_PENDING } from "../../bridge/providers/xreserve/helper-types";

export function ManualHelperActions({ activity, refresh }: { activity: Activity; refresh: () => void }) {
  const store = useActivityStore(), helper = activity.cctpHelper;
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [arcHash, setArcHash] = useState("");
  if (!helper) return null;
  async function act(download: boolean) {
    setError(""); setBusy(true);
    try {
      const { resendManualHelper, validateBundleForActivity, requestHelperObservation } = await import("../../bridge/providers/xreserve/helper-manual");
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
      const observed = await requestHelperObservation(current, undefined, { exportCall: true });
      if (observed.state !== "ready") throw new Error("The manual call is not currently validated. Refresh status before exporting.");
      const bundle = validateBundleForActivity(observed.bundle, saved);
      if (!bundle.simulation || Date.now() - Date.parse(bundle.simulation.checkedAt) > 30_000) throw new Error("Fresh Arc simulation is required before exporting.");
      const href = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = href; link.download = `miden-manual-arc-${saved.attemptId}.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch (cause) {
      if (download) {
        refresh();
      }
      setError(cause instanceof Error ? cause.message : "Manual operation unavailable.");
    }
    finally { setBusy(false); }
  }
  async function importArcHash() {
    setError(""); setBusy(true);
    try {
      if (!/^0x[0-9a-fA-F]{64}$/.test(arcHash)) throw new Error("Enter a complete Arc transaction hash.");
      const current = store.get(activity.id)?.activity;
      if (!current?.cctpHelper) throw new Error("Saved source activity is unavailable.");
      const { requestHelperObservation, validateBundleForActivity, validateHelperCompletion } = await import("../../bridge/providers/xreserve/helper-manual");
      const observed = await requestHelperObservation(current, undefined, { arcHash: arcHash.toLowerCase() as `0x${string}` });
      if (observed.state !== "tracking" || !observed.completion.arc) throw new Error("This hash has no verified matching finalized completion. Saved progress is unchanged.");
      const bundle = validateBundleForActivity(observed.bundle, current.cctpHelper);
      validateHelperCompletion(current, bundle, observed.completion);
      const completion = observed.completion;
      await withHelperJournalUpdate(() => {
        store.sync();
        const latest = store.get(current.id)?.activity.cctpHelper;
        if (!latest) throw new Error("Saved source activity is unavailable.");
        validateBundleForActivity(bundle, latest);
        store.patch(current.id, { cctpHelper: { ...latest, bundle, sourceEvidence: bundle.source, signedBytes: undefined,
          completion, stage: completion.stage }, xreserveArcTxHash: completion.arc?.transactionHash });
        if (store.get(current.id)?.unsavedChanges) throw new Error("Verified evidence could not be saved. Retry without another source burn.");
      });
      refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Arc verification unavailable."); }
    finally { setBusy(false); }
  }
  return <div className="mt-5 grid gap-3 rounded-lg border border-border p-4 text-sm">
    <p>Deployment: <code>{helper.authorization.deploymentId}</code></p>
    <p>Recipient: <code className="break-all">{activity.midenAccount}</code></p>
    {manualHelperDirection.phases[helper.stage]?.message && <p>{manualHelperDirection.phases[helper.stage].message}</p>}
    {!helper.completion?.arc && helper.stage !== "source_failed" && helper.stage !== "ready" && <p>{MANUAL_PENDING}</p>}
    {helper.reason && <p role="status">Observation: {helper.reason.replaceAll("_", " ")}. Keep this attempt; do not burn again.</p>}
    {helper.completion?.arc && <a className="underline" href={`${evmNetworks[helper.authorization.deployment.environment === "testnet" ? "arc-testnet" : "arc"].blockExplorers.default.url}/tx/${helper.completion.arc.transactionHash}`} target="_blank" rel="noreferrer">Verified Arc transaction</a>}
    {activity.xreserveNoteId && <p className="break-all">Exact Miden note: <code>{activity.xreserveNoteId}</code></p>}
    {helper.stage !== "delivered" && <>
      <label className="grid gap-1">Optional Arc transaction hash<input aria-label="Arc transaction hash" value={arcHash} onChange={event => setArcHash(event.target.value)} className="rounded border p-2" /></label>
      <Button type="button" variant="secondary" disabled={busy || !arcHash} onClick={() => void importArcHash()}>Verify Arc transaction</Button>
      <p>Older transfers can take longer to find. If another payer completed the Arc step, enter its transaction hash to check it. Do not start another burn while this transfer is unresolved.</p>
    </>}
    {helper.signedBytes && <Button type="button" variant="secondary" disabled={busy} onClick={() => void act(false)}>Retry saved source transaction</Button>}
    {["ready", "attested"].includes(helper.stage) && !helper.completion?.arc && <>
      <p>Optional fallback needs a separate funded Arc payer and gas. Independently validate and simulate the exported call; reconcile any uncertain submission before paying again.</p>
      <Button type="button" variant="primary" disabled={busy} onClick={() => void act(true)}>Download verified Arc call</Button>
    </>}
    {error && <FormAlert role="alert">{error}</FormAlert>}
  </div>;
}
