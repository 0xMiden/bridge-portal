import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { keccak256, pad } from "viem";
import { ActivityStore, activityState, applyActivityPatch, normalizeActivityState } from "./activity";
import type { Activity } from "./core/models";
import { createActivity } from "../app/lib/bridge-presentation";
import { activityPersistence, loadManualSubmissionActivities, loadStoredActivities, saveActivities } from "../app/lib/bridge-persistence";
import { submitBridgeTransfer, type SubmissionEffects } from "../app/lib/bridge-submission";
import { currentBridgeConfig } from "../config/bridge-config";
import { authorization, deployment, signedFixture } from "./providers/xreserve/fixtures/manual/test-fixture";
import { validateManualSource } from "./solana/source-transaction";
import { guardSolanaTransaction } from "./solana/rpc";
import { validateManualHelperAttestation } from "./providers/xreserve/helper-manual.server";
import { validateHelperCompletion } from "./providers/xreserve/helper-manual";
import { helperActivitySchema } from "./providers/xreserve/helper-types";
import { deriveArcNoteId } from "./providers/xreserve/delivery";
import { browserMidenSdk } from "../../test/miden-sdk";

vi.mock("server-only", () => ({}));
vi.mock("../config/cctp-helper-public.json", async () => ({ default: (await import("./providers/xreserve/fixtures/manual/deployment.json")).default }));
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as `0x${string}`;
const uint = (n: number, size: number) => n.toString(16).padStart(size * 2, "0");
let current: Activity, conflicting: Partial<Activity>;

beforeAll(async () => {
  const signed = await signedFixture(), auth = authorization();
  const source = await validateManualSource(guardSolanaTransaction(signed.raw, signed.signature), deployment);
  let message = `${source.message.slice(0, 26)}${uint(1234, 32)}${source.message.slice(90)}` as `0x${string}`;
  message = `${message.slice(0, 290)}${uint(2000, 4)}${message.slice(298)}` as `0x${string}`;
  message = `${message.slice(0, 626)}${uint(10, 32)}${message.slice(690)}` as `0x${string}`;
  const bundle = (await validateManualHelperAttestation(source, { sourceTxHash: signed.signature,
    messages: [{ status: "complete", message, attestation: `0x${"ab".repeat(65)}` }] }, deployment,
  { deploymentId: deployment.deploymentId, solanaRpc: "https://fixture.invalid", arcRpc: "https://fixture.invalid",
    irisApi: "https://iris-api-sandbox.circle.com", simulationCaller: "0x7777777777777777777777777777777777777777" }, false))!;
  const route = { id: `testnet:cctp-helper-solana-manual:${deployment.deploymentId}`, provider: "xreserve" as const, mode: "receive" as const,
    source: { kind: "spl" as const, network: "solana-devnet" as const, mint: deployment.source.mint, decimals: 6 as const, symbol: "USDC" as const },
    destination: { kind: "miden" as const, network: "miden-testnet" as const, faucetId: deployment.miden.faucetId, decimals: 6, symbol: "USDCx" },
    recovery: currentBridgeConfig("testnet"), transport: "cctp-helper" as const, execution: "automatic" as const, helperDeployment: deployment };
  const recipient = `0x${auth.midenRecipient.slice(34, 64)}`;
  const intent = (nonce: number) => {
    const payload = `0x5a2e0acd00000001${uint(999990, 32)}${uint(10007, 4)}${"0".repeat(32)}${deployment.miden.faucetId.slice(2)}00${auth.midenRecipient.slice(2)}${pad(deployment.arc.usdc.address).slice(2)}${pad(deployment.helper.address).slice(2)}${uint(0, 32)}${hash(nonce).slice(2)}00000000` as `0x${string}`;
    return { amount: "999990", recipient, faucet: deployment.miden.faucetId, sender: deployment.helper.address,
      nonce: hash(nonce), payload, messageHash: keccak256(payload) };
  };
  const completion = { schemaVersion: 1 as const, stage: "reserve_attested" as const, catchingUp: false,
    arc: { transactionHash: hash(9), block: "100", blockHash: hash(100), helperLogIndex: 2, messageLogIndex: 0, reserveLogIndex: 1 }, intent: intent(800) };
  const helper = helperActivitySchema.parse({ schemaVersion: 2, execution: "automatic", recoveryOnly: true, attemptId: "source-proof",
    stage: "reserve_attested", authorization: auth, eventAccount: source.eventAccount, scanStartSlot: source.slot,
    signature: signed.signature, sourceEvidence: source, bundle, completion });
  const sdk = await browserMidenSdk();
  current = normalizeActivityState(createActivity(route, "1", { id: "source-proof", cctpHelper: helper,
    solanaAddress: auth.sourceAccount, midenAccount: recipient, sourceTxHash: signed.signature,
    xreserveNoteId: deriveArcNoteId(completion.intent, sdk), xreserveArcTxHash: completion.arc.transactionHash,
    receivedAmount: "0.99999", sourceTxAt: 1_700_000_000_000, updatedAt: 1_700_000_000_001 }));
  const incomingCompletion = { ...completion, arc: { ...completion.arc, transactionHash: hash(10), block: "101", blockHash: hash(101) }, intent: intent(801) };
  // Both full reserve payloads match the immutable source terms; their distinct
  // reserve nonces produce genuinely different notes through the browser WASM.
  for (const proof of [completion, incomingCompletion])
    validateHelperCompletion({ ...current, cctpHelper: { ...helper, completion: undefined } }, bundle, proof);
  conflicting = { cctpHelper: helperActivitySchema.parse({ ...helper, stage: "delivered", completion: incomingCompletion }),
    xreserveNoteId: deriveArcNoteId(incomingCompletion.intent, sdk), xreserveMidenBlock: 201,
    xreserveArcTxHash: incomingCompletion.arc.transactionHash, receivedAmount: "0.5", summary: "Conflicting receipt",
    destinationTxHash: hash(11), destinationTxAt: 1_700_000_000_100, status: "complete", xreserveStatus: "delivered" };
  expect(conflicting.xreserveNoteId).not.toBe(current.xreserveNoteId);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([false, true])("rejects a conflicting helper observation with all of its receipt fields (already delivered: %s)", delivered => {
  const previous = delivered ? normalizeActivityState({ ...current, cctpHelper: { ...current.cctpHelper!, stage: "delivered" },
    xreserveMidenBlock: 200, destinationTxAt: 1_700_000_000_050 }) : current;
  const merged = applyActivityPatch(previous, conflicting);
  expect(merged.cctpHelper).toEqual(previous.cctpHelper);
  expect(merged.xreserveNoteId).toBe(previous.xreserveNoteId);
  expect(merged).toEqual(previous);
});

it("rejects receipt fields belonging to a different helper attempt even with the same proof", () => {
  const merged = applyActivityPatch(current, { ...conflicting,
    cctpHelper: { ...current.cctpHelper!, attemptId: "another-attempt", stage: "delivered" } });
  expect(merged.xreserveMidenBlock).toBeUndefined();
  expect(merged).toEqual(current);
});

function persistence() {
  let saved = "[]", failWrite = false;
  vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_200);
  vi.stubGlobal("window", { localStorage: {
    getItem: () => saved,
    setItem: (_key: string, value: string) => { if (failWrite) throw new Error("Storage full"); saved = value; },
  } });
  saveActivities([current]);
  const store = new ActivityStore(activityPersistence); store.sync();
  expect(store.get(current.id)?.activity.cctpHelper).toEqual(current.cctpHelper);
  return { store, fail: (value: boolean) => { failWrite = value; } };
}

it("does not queue rejected financial metadata during a failed persistence write or replay it on retry", () => {
  const { store, fail } = persistence();
  fail(true);
  store.patch(current.id, conflicting);
  expect(store.get(current.id)?.activity.xreserveNoteId).toBe(current.xreserveNoteId);
  expect(store.get(current.id)?.unsavedChanges?.xreserveMidenBlock).toBeUndefined();
  fail(false); store.sync();
  const [saved] = loadStoredActivities();
  expect(saved.xreserveNoteId).toBe(current.xreserveNoteId);
  expect(saved.cctpHelper).toEqual(current.cctpHelper);
  expect(saved.xreserveMidenBlock).toBeUndefined();
  expect(store.get(current.id)?.unsavedChanges).toBeUndefined();
});

it.each([false, true])("rechecks pending observation lineage against another tab's durable proof (retry write fails: %s)", retryFails => {
  const beforeProof = normalizeActivityState({ ...current, xreserveNoteId: undefined, xreserveArcTxHash: undefined,
    cctpHelper: { ...current.cctpHelper!, stage: "attested", completion: undefined } });
  const { store, fail } = persistence();
  saveActivities([beforeProof]); store.sync();
  fail(true);
  // This observation is valid for the stale local row and remains unsaved.
  store.patch(current.id, conflicting);
  expect(store.get(current.id)?.activity.xreserveNoteId).toBe(conflicting.xreserveNoteId);
  expect(store.get(current.id)?.unsavedChanges?.cctpHelper).toBeDefined();
  fail(false);
  const otherTab = new ActivityStore(activityPersistence); otherTab.sync();
  otherTab.patch(current.id, current);
  fail(retryFails); store.sync();
  const reconciled = store.get(current.id)?.activity;
  expect(reconciled?.cctpHelper).toEqual(current.cctpHelper);
  expect(reconciled?.xreserveNoteId).toBe(current.xreserveNoteId);
  expect(reconciled?.xreserveMidenBlock).toBeUndefined();
  expect(reconciled?.destinationTxAt).toBeUndefined();
  expect(reconciled?.receivedAmount).toBe(current.receivedAmount);
  fail(false); store.sync();
  const reloaded = new ActivityStore(activityPersistence); reloaded.sync();
  expect(reloaded.get(current.id)?.activity).toEqual(store.get(current.id)?.activity);
  expect(reloaded.get(current.id)?.activity.xreserveNoteId).toBe(current.xreserveNoteId);
  expect(store.get(current.id)?.unsavedChanges).toBeUndefined();
});

it("accepts same-proof delivery identifiers and canonical lower cursor resets through persistence", () => {
  const { store } = persistence();
  saveActivities([{ ...current, xreserveNoteId: undefined }]); store.sync();
  expect(store.get(current.id)?.activity.xreserveNoteId).toBeUndefined();
  const corrupt = { nextBlock: "99999", checkpoint: { block: "99998", hash: hash(1) } };
  const helper = current.cctpHelper!;
  store.patch(current.id, { cctpHelper: { ...helper, completion: { ...helper.completion!, scan: corrupt } } });
  const reset = { nextBlock: "2001", checkpoint: { block: "2000", hash: hash(2000) }, resetFrom: corrupt };
  const patch = { cctpHelper: { ...helper, stage: "delivered" as const, completion: { ...helper.completion!, scan: reset } },
    xreserveNoteId: current.xreserveNoteId, xreserveMidenBlock: 200, destinationTxAt: 1_700_000_000_050 };
  store.patch(current.id, patch);
  store.patch(current.id, { cctpHelper: { ...helper, completion: { ...helper.completion!, scan: corrupt } } });
  const [saved] = loadStoredActivities();
  expect(saved).toMatchObject({ xreserveNoteId: current.xreserveNoteId, xreserveMidenBlock: 200,
    destinationTxAt: patch.destinationTxAt, cctpHelper: { stage: "delivered", completion: { scan: reset } } });
  expect(saved.cctpHelper?.completion?.intent).toEqual(helper.completion?.intent);
  expect(saved.cctpHelper?.authorization).toEqual(helper.authorization);
});

function ambiguityPatch(): Partial<Activity> {
  const { intent, ...completion } = current.cctpHelper!.completion!;
  const candidates = [intent!, conflicting.cctpHelper!.completion!.intent!].map(({ payload, messageHash, nonce }) => ({ payload, messageHash, nonce }));
  return { cctpHelper: { ...current.cctpHelper!, stage: "arc_deposited", completion: {
    ...completion, stage: "arc_deposited", needsAttention: true, candidates, warning: "Multiple matching reserve authorizations need review.",
  } } };
}

it("keeps a unique-to-ambiguous reserve receipt loadable and review-only with its original source lock", async () => {
  const { store } = persistence();
  expect(loadStoredActivities()).toHaveLength(1);
  expect(loadManualSubmissionActivities()).toHaveLength(1);
  store.patch(current.id, ambiguityPatch());
  const [saved] = loadStoredActivities();
  expect(loadStoredActivities()).toHaveLength(1);
  expect(loadManualSubmissionActivities()).toHaveLength(1);
  expect(saved.cctpHelper?.completion?.intent).toBeUndefined();
  expect(saved.cctpHelper?.completion?.candidates).toEqual(ambiguityPatch().cctpHelper?.completion?.candidates);
  expect(saved.cctpHelper?.completion?.needsAttention).toBe(true);
  expect(activityState(saved).phase).toBe("reserve_review");
  expect(saved.cctpHelper?.stage).toBe("arc_deposited");
  expect(saved.status).not.toBe("complete");
  expect(saved.cctpHelper?.sourceEvidence).toEqual(current.cctpHelper?.sourceEvidence);
  expect(saved.cctpHelper?.authorization).toEqual(current.cctpHelper?.authorization);
  expect(saved.cctpHelper?.bundle).toEqual(current.cctpHelper?.bundle);
  expect(saved.xreserveNoteId).toBe(current.xreserveNoteId);
  expect(saved.xreserveArcTxHash).toBe(current.xreserveArcTxHash);
  expect(saved.receivedAmount).toBe(current.receivedAmount);
  const staleDelivery = { ...current, cctpHelper: { ...current.cctpHelper!, stage: "delivered" as const }, xreserveMidenBlock: 200 };
  store.patch(current.id, staleDelivery);
  expect(loadStoredActivities()[0]).toEqual(saved);

  vi.stubGlobal("navigator", { locks: { request: async (_name: string, _options: unknown, operation: (lock: object) => unknown) => operation({}) } });
  const network = vi.fn(); vi.stubGlobal("fetch", network);
  const effects: SubmissionEffects = { activities: store, openEvmWallet: vi.fn(async () => {}), onError: vi.fn(),
    onSubmittingChange: vi.fn(), onPhaseChange: vi.fn(), navigate: vi.fn() };
  await submitBridgeTransfer({ routeId: current.routeId!, environment: "testnet", amount: "1", insufficientBalance: false,
    evmBalance: "", evmAddress: "", evmWallet: { connected: false, address: "" }, midenAsset: null,
    midenAccount: current.midenAccount!, midenWallet: { connected: true, address: current.midenAccount! },
    helperAttemptId: "new-source-attempt", sourceIdentity: { runtime: "solana", network: "solana-devnet", address: current.solanaAddress! },
  }, effects);
  expect(effects.onError).toHaveBeenCalledWith("Recover the existing source attempt. Do not burn again.");
  expect(effects.navigate).toHaveBeenCalledWith(`/activity/${current.id}`);
  expect(effects.onSubmittingChange).not.toHaveBeenCalled();
  expect(network).not.toHaveBeenCalled();
});

it.each([false, true])("keeps verified delivery unchanged after later ambiguity (claim recorded: %s)", claimed => {
  const { store } = persistence();
  store.patch(current.id, { cctpHelper: { ...current.cctpHelper!, stage: "delivered" }, xreserveMidenBlock: 200,
    destinationTxAt: 1_700_000_000_050, ...(claimed ? { claimTxHash: hash(20) } : {}) });
  const [delivered] = loadManualSubmissionActivities();
  expect(activityState(delivered).status).toBe("complete");
  expect(delivered.xreserveMidenBlock).toBe(200);
  store.patch(current.id, { ...ambiguityPatch(), receivedAmount: "0.5", xreserveNoteId: conflicting.xreserveNoteId,
    destinationTxAt: 1_700_000_000_100 });
  expect(loadManualSubmissionActivities()).toEqual([delivered]);
  expect(store.get(current.id)?.activity).toEqual(delivered);
});

it.each([false, true])("does not replay a queued unique delivery over another tab's durable ambiguity (retry write fails: %s)", retryFails => {
  const { store, fail } = persistence();
  fail(true);
  store.patch(current.id, { cctpHelper: { ...current.cctpHelper!, stage: "delivered" }, xreserveMidenBlock: 200,
    destinationTxAt: 1_700_000_000_050 });
  expect(store.get(current.id)?.unsavedChanges).toBeDefined();
  fail(false);
  const otherTab = new ActivityStore(activityPersistence); otherTab.sync();
  otherTab.patch(current.id, ambiguityPatch());
  expect(loadStoredActivities()).toHaveLength(1);
  fail(retryFails); store.sync();
  expect(activityState(store.get(current.id)!.activity).phase).toBe("reserve_review");
  expect(store.get(current.id)?.activity.xreserveMidenBlock).toBeUndefined();
  fail(false); store.sync();
  const [saved] = loadManualSubmissionActivities();
  expect(saved.cctpHelper?.completion?.needsAttention).toBe(true);
  expect(saved.cctpHelper?.completion?.intent).toBeUndefined();
  expect(saved.xreserveMidenBlock).toBeUndefined();
});
