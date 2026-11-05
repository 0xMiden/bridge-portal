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
export default function SourceRecoveryPage() {
  const store = useActivityStore(), selectEnvironment = useSelectBridgeEnvironment();
  const [receipts, setReceipts] = useState<{ id: string; recipient: string; stage: string; environment: BridgeEnvironment }[]>([]), [error, setError] = useState("");
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
    <h1 className="text-xl font-semibold">Recover a saved EVM source attempt</h1>
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
