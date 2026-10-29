import { configKey } from "../../config/bridge-config";
import { assertMidenAccountNetwork } from "../../wallets/miden/network";
import { validateTransferAmount } from "../../bridge/core/rules";
import { isQuoteReviewable, sameSourceIdentity } from "../../bridge/core/quote";
import { findBridgeRoute, routeEnvironment } from "../../bridge/core/routes";
import type { Activity, BridgeProvider } from "../../bridge/core/models";
import type { TransferSubmission, SubmissionEffects } from "../../bridge/core/submission";
import { bridgeProviders, directionFor } from "../../bridge/providers/registry";
import { createActivity } from "./bridge-presentation";
import { errorMessage } from "./wallet-errors";
import { helperActivitySchema } from "../../bridge/providers/xreserve/helper-types";
import { receiptRouteSchema } from "../../bridge/core/receipt-route";
import { arcRecipient, parseArcAmount } from "../../bridge/providers/xreserve/deposit-terms";
import { loadManualSubmissionActivities } from "./bridge-persistence";
import { manualIntentKey, reserveManualSubmission, withManualSourceLock } from "../../bridge/providers/xreserve/helper-submission-lock";

const preloaded = new Map<BridgeProvider, Promise<unknown>>();

export function preloadBridgeSubmission(provider: BridgeProvider) {
  if (!preloaded.has(provider)) {
    preloaded.set(
      provider,
      bridgeProviders[provider].load().catch(() => {
        preloaded.delete(provider);
      }),
    );
  }
}

export type { TransferSubmission, SubmissionEffects } from "../../bridge/core/submission";

/** Wallet lifecycle, receipt publication and errors are identical for all adapters. */
export async function submitBridgeTransfer(
  input: TransferSubmission,
  effects: SubmissionEffects,
): Promise<void> {
  const route = findBridgeRoute(input.routeId);
  if (route?.transport !== "cctp-helper" || !route.helperDeployment) return submitBridgeTransferLocked(input, effects);
  let release: (() => void) | undefined;
  try {
    if (!input.helperAttemptId || input.sourceIdentity?.runtime !== "solana") throw new Error("Review the manual source attempt again.");
    const intent = manualIntentKey(route.helperDeployment, input.sourceIdentity.address, parseArcAmount(input.amount).toString(), arcRecipient(input.midenAccount));
    release = reserveManualSubmission(input.helperAttemptId, intent);
    await withManualSourceLock(() => submitBridgeTransferLocked(input, effects));
  } catch (error) { effects.onError(errorMessage(error)); }
  finally { release?.(); }
}

async function submitBridgeTransferLocked(input: TransferSubmission, effects: SubmissionEffects): Promise<void> {
  const route = findBridgeRoute(input.routeId);
  if (!route || route.disabled || routeEnvironment(route) !== (input.environment ?? "testnet")) {
    effects.onError("This route isn't available in this build.");
    return;
  }
  try {
    validateTransferAmount(route, input.amount);
    assertMidenAccountNetwork(input.midenAccount, routeEnvironment(route));
    if (route.transport === "cctp-helper") { parseArcAmount(input.amount); arcRecipient(input.midenAccount); }
  } catch (error) {
    effects.onError(errorMessage(error));
    return;
  }
  if (input.insufficientBalance) {
    effects.onError(
      `Not enough ${route.source.symbol} — this wallet holds ${input.evmBalance}. Lower the amount.`,
    );
    return;
  }
  if (!input.midenWallet.connected || !input.midenWallet.address) {
    effects.onError("Connect your Bread wallet before transferring.");
    return;
  }

  let recorded: Activity | undefined;
  const manual = route.transport === "cctp-helper";
  if (manual) {
    if (!effects.activities.get || !effects.activities.getSnapshot || !effects.activities.sync || !input.helperAttemptId) {
      effects.onError("Durable manual transfer storage is unavailable."); return;
    }
    // Read strictly while holding the origin lock; stale stores and invalid rows cannot authorize a new burn.
    const durable = loadManualSubmissionActivities();
    effects.activities.sync();
    // sync() deliberately swallows persistence errors for ordinary receipts. The strict
    // read itself remains authoritative even if that subsequent refresh cannot read.
    const history = [...durable, ...effects.activities.getSnapshot().receipts.map(receipt => receipt.activity)];
    recorded = history.find(activity => activity.cctpHelper?.attemptId === input.helperAttemptId);
    const intent = manualIntentKey(route.helperDeployment!, input.sourceIdentity!.address, parseArcAmount(input.amount).toString(), arcRecipient(input.midenAccount));
    const unresolved = history.find(activity => {
      const helper = activity.cctpHelper, auth = helper?.authorization;
      return helper && auth && helper.attemptId !== input.helperAttemptId &&
        manualIntentKey(auth.deployment, auth.sourceAccount, auth.grossAmount, auth.midenRecipient) === intent &&
        helper.stage !== "source_failed";
    });
    if (unresolved) { effects.navigate(`/activity/${unresolved.id}`); effects.onError("Recover the existing source attempt. Do not burn again."); return; }
  }
  const update = (patch: Partial<Activity>) => {
    if (!recorded) return;
    recorded = effects.activities.patch(recorded.id, patch) ?? recorded;
  };
  effects.onSubmittingChange(true);
  try {
    if (!manual && (
      !input.evmWallet.connected || !input.evmWallet.address ||
      (route.mode === "receive" && !input.evmWallet.provider)
    )) {
      await effects.openEvmWallet();
      return;
    }
    if (input.midenAccount !== input.midenWallet.address ||
        (!manual && input.evmAddress.toLowerCase() !== input.evmWallet.address.toLowerCase())) {
      throw new Error("Your connected wallet changed. Review the transfer again.");
    }
    const { flows } = await bridgeProviders[route.provider].load();
    const requiresQuote = directionFor(route).fees(route).requiresQuote;
    if (requiresQuote) {
      const quote = input.quote;
      if (
        !isQuoteReviewable(quote) ||
        quote.request.routeId !== route.id ||
        configKey(quote.request.recovery) !== configKey(route.recovery) ||
        quote.request.amount !== input.amount ||
        quote.request.midenAccount !== input.midenAccount ||
        quote.request.evmAddress.toLowerCase() !== input.evmAddress.toLowerCase() ||
        !sameSourceIdentity(quote.request.sourceIdentity, input.sourceIdentity)
      ) {
        throw new Error("Refresh and review the quote before sending.");
      }
    }
    if (route.mode === "receive") {
      if (!effects.verifyBalanceCap) {
        throw new Error("Unable to verify the $1,232.462 balance limit. Refresh the page and try again.");
      }
      await effects.verifyBalanceCap(route, input.amount, input.midenAccount);
    }
    // Account and price reads can outlast a reviewed quote's validity window.
    if (requiresQuote && !isQuoteReviewable(input.quote)) {
      throw new Error("Refresh and review the quote before sending.");
    }
    await flows[route.mode].submit({
      input,
      route,
      existingHelper: recorded?.cctpHelper,
      phase: effects.onPhaseChange,
      update,
      saveHelperDurably: manual ? (patch) => {
        helperActivitySchema.parse(patch.cctpHelper);
        receiptRouteSchema.parse(route);
        if (recorded) recorded = effects.activities.patch(recorded.id, patch) ?? recorded;
        else recorded = effects.activities.record(createActivity(route, input.amount, { ...patch, id: `act-${input.helperAttemptId}` }));
        const receipt = effects.activities.get?.(recorded.id);
        if (!receipt || receipt.unsavedChanges) throw new Error(patch.cctpHelper?.signature
          ? "The signed transaction could not be saved. Nothing was broadcast. Keep this tab open and retry saving the same attempt."
          : "The reviewed attempt could not be saved. Phantom was not asked to sign. Keep this tab open and retry.");
        return receipt.activity;
      } : undefined,
      record: (patch) => {
        if (recorded) {
          update(patch);
          if (manual) effects.navigate(`/activity/${recorded.id}`);
          return recorded;
        }
        recorded = effects.activities.record(createActivity(route, input.amount, patch));
        effects.navigate(`/activity/${recorded.id}`);
        return recorded;
      },
    });
  } catch (error) {
    // An RPC/solver outage after broadcast is not proof that the transfer failed.
    effects.onError(
      manual
        ? `${recorded?.cctpHelper?.stage === "source_unknown" ? "Source submission is unknown. Keep the saved signature; do not burn again. " : ""}${errorMessage(error)}`
        : recorded
        ? `Transfer submitted. Keep its receipt; do not submit again. ${errorMessage(error)}`
        : errorMessage(error),
    );
  } finally {
    effects.onSubmittingChange(false);
    effects.onPhaseChange("");
  }
}
