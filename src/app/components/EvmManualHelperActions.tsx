"use client";
import { useState } from "react";
import type { Activity } from "../../bridge/core/models";
import { useActivityStore } from "./ActivityProvider";
import { Button } from "./ui/Button";
import { FormAlert } from "./ui/Feedback";
import { bytes32 } from "../../config/cctp-helper";
import { EvmHelperJournal } from "../../bridge/providers/xreserve/helper-evm-journal";
import { recheckEvmHelper } from "../../bridge/providers/xreserve/helper-evm-recovery";
export function EvmManualHelperActions({ activity }: { activity: Activity }) {
  const store = useActivityStore(), helper = activity.cctpEvmHelper;
  const [hash, setHash] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  if (!helper) return null;
  async function act(download: boolean) {
    setError(""); setBusy(true);
    try {
      const current = store.get(activity.id)?.activity.cctpEvmHelper;
      if (!current) throw new Error("Saved EVM source receipt unavailable.");
      const journal = new EvmHelperJournal(), saved = journal.read().find(row => row.attemptId === current.attemptId);
      if (!saved || saved.intent !== current.intent) throw new Error("Original source journal unavailable. Recover it before proceeding.");
      const editable = !saved.hash || saved.hashOrigin === "imported" && !saved.source;
      const row = editable ? { ...saved, hash: bytes32.parse((hash || saved.hash || "").trim().toLowerCase()), hashOrigin: "imported" as const } : saved;
      const next = await recheckEvmHelper(row);
      store.patch(activity.id, { cctpEvmHelper: next, sourceTxHash: next.hash });
      // The strict journal is authoritative if ordinary activity storage is unavailable.
      if (download) {
        if (next.stage !== "ready" || !next.bundle) throw new Error("Fresh atomic Arc call validation is unavailable.");
        const href = URL.createObjectURL(new Blob([JSON.stringify(next.bundle, null, 2)], { type: "application/json" }));
        const link = document.createElement("a"); link.href = href; link.download = `miden-manual-arc-${next.attemptId}.json`; link.click();
        setTimeout(() => URL.revokeObjectURL(href), 1000);
      }
    } catch (cause) {
      const current = store.get(activity.id)?.activity.cctpEvmHelper;
      if (current) store.patch(activity.id, { cctpEvmHelper: { ...current, stage: "needs_attention", reason: "Fresh source and manual Arc call validation is unavailable." } });
      setError(cause instanceof Error ? cause.message : "Source recovery unavailable.");
    } finally { setBusy(false); }
  }
  return <div className="mt-5 grid gap-3 rounded-lg border border-border p-4 text-sm">
    <p>Source wallet requests are never retried. Recover the original hash from your wallet history if its response was lost.</p>
    <p>Recipient: <code className="break-all">{activity.midenAccount}</code></p>
    {helper.reason && <p role="status">{helper.reason}</p>}
    {(!helper.hash || helper.hashOrigin === "imported" && !helper.source) && <label>Original source transaction hash<input className="w-full rounded border p-2" value={hash || helper.hash || ""} onChange={event => setHash(event.target.value)} placeholder="0x…" /></label>}
    <Button type="button" variant="secondary" disabled={busy} onClick={() => void act(false)}>Recheck original source and attestation</Button>
    {helper.stage === "ready" && <Button type="button" variant="primary" disabled={busy} onClick={() => void act(true)}>Download manual Arc call</Button>}
    {error && <FormAlert role="alert">{error}</FormAlert>}
  </div>;
}
