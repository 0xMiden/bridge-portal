import { evmHelperIntent, evmHelperCallData } from "./helper-evm-call";
import { assertEmbeddedRecipient, assertManualAmounts } from "./helper-hook";
import { assertHelperConfig } from "../../../config/cctp-helper";
import { assertEvmSourceMessage, validateEvmBundle } from "./helper-evm-validation";
import { configKey } from "../../../config/bridge-config";
import { z } from "zod";
import { evmHelperActivitySchema, type EvmHelperActivity } from "./helper-evm-types";
export const evmJournalKey = "miden.bridge.cctp-helper.evm.v1";
type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;
/** A strict journal survives receipt/UI corruption and never silently discards an unknown send. */
export class EvmHelperJournal {
  constructor(private readonly storage: Storage = window.localStorage) {}
  read() {
    const raw = this.storage.getItem(evmJournalKey);
    const rows = z.array(evmHelperActivitySchema).max(1000).parse(raw === null ? [] : JSON.parse(raw));
    const ids = new Set<string>();
    for (const row of rows) {
      if (ids.has(row.attemptId)) throw new Error("Duplicate saved source attempts. Preserve the original journal.");
      ids.add(row.attemptId); validateEvmJournalRow(row);
    }
    return rows;
  }
  assertNew(attempt: string, intent: string) {
    if (this.read().some(row => row.attemptId === attempt || row.intent === intent && row.stage !== "source_failed"))
      throw new Error("Recover the saved EVM source attempt. Do not burn again.");
  }
  save(value: EvmHelperActivity) {
    let row = evmHelperActivitySchema.parse(value);
    const rows = this.read();
    const previous = rows.find(entry => entry.attemptId === row.attemptId);
    if (previous) row = mergeEvmJournal(previous, row);
    row = evmHelperActivitySchema.parse(JSON.parse(JSON.stringify(row)));
    validateEvmJournalRow(row);
    const next = [...rows.filter(entry => entry.attemptId !== row.attemptId), row];
    this.storage.setItem(evmJournalKey, JSON.stringify(next));
    const actual = this.read().find(entry => entry.attemptId === row.attemptId);
    if (configKey(actual) !== configKey(row)) throw new Error("Source attempt could not be saved. Do not invoke the wallet again.");
    return row;
  }
}

/** Stale observers cannot erase a returned hash or a previously verified burn. */
export function mergeEvmJournal(previous: EvmHelperActivity, incoming: EvmHelperActivity): EvmHelperActivity {
  if (previous.intent !== incoming.intent || configKey(previous.authorization) !== configKey(incoming.authorization)) throw new Error("Source attempt identity changed.");
  if (configKey(previous.recovery) !== configKey(incoming.recovery)) throw new Error("Source recovery context changed.");
  if (previous.callData !== incoming.callData || previous.startBlock !== incoming.startBlock) throw new Error("Source attempt call changed.");
  const next = { ...incoming, ...mergeEvmHash(previous, incoming) };
  if (!previous.source) return next;
  const conflict = incoming.source && configKey(previous.source) !== configKey(incoming.source);
  if (incoming.stage === "source_failed" || !incoming.source || conflict) return { ...next, source: previous.source, bundle: previous.bundle,
    stage: "needs_attention", failedBlock: undefined, failedBlockHash: undefined, reason: "Fresh source evidence conflicts with an established burn. Do not burn again." };
  return { ...next, source: previous.source };
}

function mergeEvmHash(previous: EvmHelperActivity, incoming: EvmHelperActivity) {
  const replaceable = previous.hashOrigin === "imported" && !previous.source && incoming.hashOrigin === "imported";
  const changed = previous.hash && incoming.hash && previous.hash !== incoming.hash;
  if (changed && !replaceable) throw new Error("Conflicting source transaction hashes. Keep the original attempt.");
  const candidates = [previous, incoming].flatMap(row => [
    ...(row.candidateHashes ?? []), ...(row.hashOrigin === "imported" && row.hash ? [row.hash] : []),
  ]);
  const candidateHashes = [...new Set(candidates)];
  return { hash: replaceable ? incoming.hash : previous.hash ?? incoming.hash,
    hashOrigin: previous.hashOrigin ?? incoming.hashOrigin, ...(candidateHashes.length ? { candidateHashes } : {}) };
}

/** Corrupt but well-shaped orphan rows cannot turn into permission for a second burn. */
function validateEvmJournalRow(row: EvmHelperActivity) {
  const auth = row.authorization;
  if (row.intent !== evmHelperIntent(auth) || row.callData !== evmHelperCallData(auth)) throw new Error("Saved source intent or call is inconsistent.");
  if (auth.deploymentId !== auth.deployment.deploymentId) throw new Error("Saved source deployment identity is inconsistent.");
  assertHelperConfig(auth.deployment, row.recovery); assertEmbeddedRecipient(auth.midenRecipient); assertManualAmounts(auth);
  validateSavedEvmSource(row);
  if (row.stage === "source_finalized" && !row.source) throw new Error("Finalized source evidence is missing.");
  if (row.stage === "ready" && !row.bundle) throw new Error("Ready source bundle is missing.");
  if (row.bundle) validateEvmBundle(row.bundle, row);
}

function validateSavedEvmSource(row: EvmHelperActivity) {
  const source = row.source, auth = row.authorization;
  if (!source) return;
  assertEvmSourceMessage(source.message, auth);
  if (source.sourceTransaction !== row.hash || BigInt(source.blockNumber) < BigInt(row.startBlock)) throw new Error("Saved source occurrence is inconsistent.");
  for (const field of ["sourceAccount", "grossAmount", "maxCctpFee", "midenRecipient"] as const)
    if (source[field] !== auth[field]) throw new Error("Saved source evidence does not match its review.");
}
