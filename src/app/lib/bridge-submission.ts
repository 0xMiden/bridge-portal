import { assertMidenAccountNetwork } from "../../wallets/miden/network";
import { validateTransferAmount } from "../../bridge/core/rules";
import { findBridgeRoute, routeEnvironment } from "../../bridge/core/routes";
import type { Activity, BridgeProvider } from "../../bridge/core/models";
import type { TransferSubmission, SubmissionEffects } from "../../bridge/core/submission";
import { bridgeProviders, directionFor } from "../../bridge/providers/registry";
import { shortAddress } from "../../wallets/identity";
import { createActivity } from "./bridge-presentation";
import { loadStoredActivities, patchStoredActivity, saveActivities } from "./bridge-persistence";
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

/** Wallet lifecycle, persistence and errors are identical for all adapters. */
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
  const publish = () => effects.onActivitiesChange(loadStoredActivities());
  const update = (patch: Partial<Activity>) => {
    if (!recorded) return;
    patchStoredActivity(recorded.id, patch);
    publish();
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
    if (directionFor(route).fees(route).requiresQuote) {
      const quote = input.quote;
      if (
        !quote ||
        // CCTP expiry is checked against Circle's source-chain tip by its provider.
        (quote.kind !== "cctp" && quote.expiresAt <= Date.now()) ||
        quote.request.routeId !== route.id ||
        quote.request.deploymentId !== route.deploymentId ||
        quote.request.amount !== input.amount ||
        quote.request.midenAccount !== input.midenAccount ||
        quote.request.evmAddress.toLowerCase() !== input.evmAddress.toLowerCase()
      ) {
        throw new Error("Refresh and review the quote before sending.");
      }
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
        recorded = createActivity(route, input.amount, {
          ...patch,
          ...(patch.sourceTxHash ? { txHash: shortAddress(patch.sourceTxHash) } : {}),
        });
        saveActivities([recorded, ...loadStoredActivities()]);
        publish();
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
