import { configKey } from "../../config/bridge-config";
import { assertMidenAccountNetwork } from "../../wallets/miden/network";
import { validateTransferAmount } from "../../bridge/core/rules";
import { isQuoteReviewable } from "../../bridge/core/quote";
import { findBridgeRoute, routeEnvironment } from "../../bridge/core/routes";
import type { Activity, BridgeProvider } from "../../bridge/core/models";
import type { TransferSubmission, SubmissionEffects } from "../../bridge/core/submission";
import { bridgeProviders, directionFor } from "../../bridge/providers/registry";
import { createActivity } from "./bridge-presentation";
import { errorMessage } from "./wallet-errors";

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
  if (!route || route.disabled || routeEnvironment(route) !== (input.environment ?? "testnet")) {
    effects.onError("This route isn't available in this build.");
    return;
  }
  try {
    validateTransferAmount(route, input.amount);
    assertMidenAccountNetwork(input.midenAccount, routeEnvironment(route));
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
  const update = (patch: Partial<Activity>) => {
    if (!recorded) return;
    recorded = effects.activities.patch(recorded.id, patch) ?? recorded;
  };
  effects.onSubmittingChange(true);
  try {
    if (
      !input.evmWallet.connected || !input.evmWallet.address ||
      (route.mode === "receive" && !input.evmWallet.provider)
    ) {
      await effects.openEvmWallet();
      return;
    }
    if (input.midenAccount !== input.midenWallet.address ||
        input.evmAddress.toLowerCase() !== input.evmWallet.address.toLowerCase()) {
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
        quote.request.evmAddress.toLowerCase() !== input.evmAddress.toLowerCase()
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
      phase: effects.onPhaseChange,
      update,
      record: (patch) => {
        if (recorded) {
          update(patch);
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
      recorded
        ? `Transfer submitted. Keep its receipt; do not submit again. ${errorMessage(error)}`
        : errorMessage(error),
    );
  } finally {
    effects.onSubmittingChange(false);
    effects.onPhaseChange("");
  }
}
