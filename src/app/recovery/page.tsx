"use client";
import { useState } from "react";
import Link from "next/link";
import { EvmHelperJournal } from "../../bridge/providers/xreserve/helper-evm-journal";
import { restoreEvmJournalReceipt } from "../../bridge/providers/xreserve/helper-evm-receipt";
import { useActivityStore } from "../components/ActivityProvider";
import { useSelectBridgeEnvironment } from "../components/NetworkProvider";
import type { BridgeEnvironment } from "../../config/environment";
import { Button } from "../components/ui/Button";
import { FormAlert } from "../components/ui/Feedback";
import { helperDeployments } from "../../config/cctp-helper";
import { recoverSolanaHelper } from "../../bridge/providers/xreserve/helper-recovery";
import { withManualSourceLock } from "../../bridge/providers/xreserve/helper-submission-lock";
import { loadManualSubmissionActivities } from "../lib/bridge-persistence";
export default function SourceRecoveryPage() {
  const store = useActivityStore(), selectEnvironment = useSelectBridgeEnvironment();
  const [receipts, setReceipts] = useState<{ id: string; recipient: string; stage: string; environment: BridgeEnvironment }[]>([]), [error, setError] = useState("");
  const [deploymentId, setDeploymentId] = useState(helperDeployments[0]?.deploymentId ?? ""), [signature, setSignature] = useState("");
  const [busy, setBusy] = useState(false);
  async function recoverSolana() {
    setError(""); setBusy(true);
    try {
      await withManualSourceLock(async () => {
        store.sync();
        const activity = await recoverSolanaHelper(deploymentId, signature.trim(), loadManualSubmissionActivities());
        store.record(activity);
        if (store.get(activity.id)?.unsavedChanges) throw new Error("Recovered evidence could not be saved. Preserve the signature and retry.");
        setReceipts(rows => [{ id: activity.id, recipient: activity.midenAccount ?? "", stage: activity.cctpHelper!.stage, environment: activity.environment! }, ...rows.filter(row => row.id !== activity.id)]);
      });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Source recovery unavailable."); }
    finally { setBusy(false); }
  }
  function restore() {
    setError("");
    try {
      const rows = new EvmHelperJournal().read();
      const restored = rows.map(row => {
        const activity = restoreEvmJournalReceipt(row);
        store.record(activity);
        return { id: activity.id, recipient: activity.midenAccount ?? "", stage: row.stage, environment: row.recovery.environment };
      });
      setReceipts(restored);
      if (!restored.length) setError("No saved EVM source attempts are present on this browser origin.");
    } catch { setError("Saved source journal cannot be read safely. Preserve this browser's storage and recover the original evidence before any new burn."); }
  }
  return <main className="mx-auto mt-8 grid max-w-xl gap-4 p-4">
    <h1 className="text-xl font-semibold">Recover a source transfer</h1>
    <h2 className="font-semibold">Recover Solana transfer</h2>
    <p>Enter the original signature and deployment/network. The finalized source determines the original recipient. Recovery never requests a source signature or starts another burn.</p>
    <label className="grid gap-1">Deployment and source network<select value={deploymentId} onChange={event => setDeploymentId(event.target.value)} className="rounded border p-2">
      {!helperDeployments.length && <option value="">No historical Solana deployment configured</option>}
      {helperDeployments.map(deployment => <option key={deployment.deploymentId} value={deployment.deploymentId}>{deployment.deploymentId} · {deployment.source.network}</option>)}
    </select></label>
    <label className="grid gap-1">Original Solana signature<input aria-label="Original Solana signature" value={signature} onChange={event => setSignature(event.target.value)} className="rounded border p-2" /></label>
    <Button type="button" disabled={busy || !deploymentId || !signature.trim()} onClick={() => void recoverSolana()}>Recover Solana transfer</Button>
    <p>This only checks the original transfer. If its history is unavailable, keep the signature and wait before sending again. Finding older transfers on Arc can take longer.</p>
    <h2 className="font-semibold">Recover a saved EVM source attempt</h2>
    <p>This restores the original recipient and transfer terms from the source journal. Rechecking never invokes your source wallet or starts another burn.</p>
    <p>Disabled or removed deployments remain visible. Fresh chain validation may be unavailable; keep the saved evidence.</p>
    <Button type="button" onClick={restore}>Load saved source attempts</Button>
    {receipts.map(row => <div key={row.id} className="rounded border p-3">
      <Link className="underline" href={`/activity/${row.id}`} onNavigate={() => selectEnvironment(row.environment)}>Recover original attempt</Link>
      <p className="break-all">Recipient: {row.recipient}</p><p>Saved state: {row.stage.replaceAll("_", " ")}</p>
    </div>)}
    {error && <FormAlert role="alert">{error}</FormAlert>}
    <Link className="underline" href="/">Return to bridge</Link>
  </main>;
}
