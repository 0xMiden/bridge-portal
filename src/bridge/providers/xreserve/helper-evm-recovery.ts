import { withHelperJournalUpdate } from "./helper-submission-lock";
import type { Activity } from "../../core/models";
import { evmHelperIntent } from "./helper-evm-call";
import { evmManualJson } from "./helper-evm";
import { EvmHelperJournal } from "./helper-evm-journal";
import { evmObservationSchema, type EvmHelperActivity, type EvmObservation } from "./helper-evm-types";
import { validateEvmBundle, assertEvmSourceMessage } from "./helper-evm-validation";
export function applyEvmObservation(row: EvmHelperActivity, value: unknown): EvmHelperActivity {
  const observation = evmObservationSchema.parse(value), auth = row.authorization;
  if (row.intent !== evmHelperIntent(auth)) throw new Error("Saved EVM intent changed.");
  if (observation.state === "ready") {
    const bundle = validateEvmBundle(observation.bundle, row);
    return { ...row, stage: "ready", source: bundle.source, bundle, reason: undefined };
  }
  if (observation.state === "source_failed") return failedEvmSource(row, observation);
  if (observation.state === "source_finalized") {
    assertEvmSourceMessage(observation.source.message, auth);
    if (observation.source.sourceTransaction !== row.hash || BigInt(observation.source.blockNumber) < BigInt(row.startBlock)) throw new Error("Source occurrence mismatch.");
    return { ...row, stage: row.stage === "ready" ? "needs_attention" : "source_finalized", source: observation.source };
  }
  return { ...row, stage: row.source || row.stage === "ready" || observation.state === "needs_attention" ? "needs_attention" : "source_unknown",
    reason: observation.state === "needs_attention" ? observation.reason : "Fresh source or attestation evidence is pending. Do not burn again." };
}
function failedEvmSource(row: EvmHelperActivity, observation: Extract<EvmObservation, { state: "source_failed" }>): EvmHelperActivity {
  if (row.source || row.hashOrigin !== "wallet") return { ...row, stage: "needs_attention", reason: "A failed or imported hash cannot disprove the unresolved original burn." };
  if (observation.hash !== row.hash || BigInt(observation.blockNumber) < BigInt(row.startBlock)) throw new Error("Failed source occurrence mismatch.");
  return { ...row, stage: "source_failed", failedBlock: observation.blockNumber, failedBlockHash: observation.blockHash, bundle: undefined };
}
export async function recheckEvmHelper(row: EvmHelperActivity, signal?: AbortSignal) {
  if (!row.hash) throw new Error("Supply the source wallet transaction hash. No new wallet request is permitted.");
  const observed = await evmManualJson("attestation", { authorization: row.authorization, hash: row.hash }, signal);
  return withHelperJournalUpdate(() => {
    const journal = new EvmHelperJournal(), latest = journal.read().find(entry => entry.attemptId === row.attemptId);
    if (!latest || latest.intent !== row.intent) throw new Error("Original source journal unavailable.");
    const replaceable = latest.hashOrigin === "imported" && !latest.source && row.hashOrigin === "imported";
    if (latest.hash && latest.hash !== row.hash && !replaceable) throw new Error("Conflicting source hash. Recover the original attempt.");
    const current = { ...latest, hash: replaceable ? row.hash : latest.hash ?? row.hash, hashOrigin: latest.hashOrigin ?? row.hashOrigin };
    return journal.save(applyEvmObservation(current, observed));
  });
}

export async function observeEvmManualHelper(activity: Activity, signal: AbortSignal) {
  const row = activity.cctpEvmHelper;
  if (!row) throw new Error("Saved EVM source attempt unavailable.");
  try { return { patch: { cctpEvmHelper: await recheckEvmHelper(row, signal) } }; }
  catch (error) {
    if (signal.aborted) throw error;
    const next = await withHelperJournalUpdate(() => {
      const journal = new EvmHelperJournal(), latest = journal.read().find(entry => entry.attemptId === row.attemptId);
      if (!latest) throw new Error("Original source journal unavailable.");
      return journal.save({ ...latest, stage: "needs_attention", reason: "Fresh validation unavailable. Recover this source attempt; do not burn again." });
    });
    return { patch: { cctpEvmHelper: next } };
  }
}
