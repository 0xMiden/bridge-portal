import { activityRoute } from "../../core/routes";
import { epochRouteAssets } from "./bridgeable-token";
import { MIDEN_DESTINATION_CHAIN_ID } from "./config";
import { epochActivityState, epochDestinationTx } from "./epoch-status";
import type { SubmissionContext } from "../../core/submission";
import type { ActivityMonitor, ProviderFlows } from "../../core/provider";
import { ensureEvmNetwork } from "../../../wallets/evm/ensure-network";
import { midenAccountLink } from "../../miden-account-link";
import { createPublicClient, type Hex } from "viem";
import { evmReadTransport } from "../../evm/transport";
import { findTransactionReceipt } from "../../evm/transaction-receipt";

const phaseLabels: Record<string, string> = {
  starting: "Preparing your Epoch deposit…",
  "switching-chain": "Switch to the source network in your wallet…",
  "preparing-transaction": "Preparing your Epoch deposit…",
  "waiting-for-transaction": "Confirming your deposit…",
  batching: "Approve & deposit in your wallet…",
  sending: "Confirm the deposit in your wallet…",
  sent: "Deposit sent — Epoch is delivering to Miden (1–3 min)…",
};

export const flows: ProviderFlows = {
  receive: {
    async quote(input) {
      const { quoteEpochReceive } = await import("./epoch-quote");
      return quoteEpochReceive(input);
    },
    async submit(context) {
      const provider = context.input.evmWallet.provider;
      if (!provider) throw new Error("Connect your Ethereum wallet.");
      if (!context.input.midenAccount)
        throw new Error("Connect your Bread wallet or paste a Miden account to receive into.");
      await ensureEvmNetwork(provider, epochRouteAssets(context.route).chain);
      await execute(context, context.input.midenAccount);
    },
    monitor: intentMonitor(),
  },
  send: {
    async quote(input) {
      const { quoteEpochSend } = await import("./epoch-quote");
      return quoteEpochSend(input);
    },
    async submit(context) {
      if (!/^0x[0-9a-fA-F]{40}$/.test(context.input.evmAddress))
        throw new Error("Enter a valid EVM (0x…) address, or connect your wallet.");
      await execute(context, context.input.evmAddress);
    },
    monitor: intentMonitor(),
  },
};
async function execute(
  { input, route, phase, record, update }: SubmissionContext,
  destination: string,
) {
  if (input.quote?.kind !== "epoch") throw new Error("Refresh and review the quote before sending.");
  phase("Confirm in your wallet…");
  const { runEpochTransfer } = await import("./epoch-execute");
  const accounts = {
    destination,
    midenAccount: input.midenAccount,
    evmAddress: input.evmAddress,
    midenAccountHex: route.mode === "receive" ? midenAccountLink(destination) : undefined,
    epochSponsor: input.evmAddress,
  };
  let submitted = false;
  const result = await runEpochTransfer({
    route,
    amount: input.amount,
    minReceived: input.quote.received,
    midenAccount: input.midenAccount,
    evmAddress: input.evmAddress,
    requestTransaction: input.midenWallet.requestTransaction,
    waitForTransaction: input.midenWallet.waitForTransaction,
    onSubmitted: ({ midenNoteId, ...source }) => {
      submitted = true;
      record({
        ...accounts,
        status: "source_finality",
        ...source,
        midenTxId: midenNoteId,
      });
    },
    onStatus: (observation) => {
      const message = phaseLabels[observation.phase] ?? "Working…";
      phase(message);
      update({ eta: message });
    },
  }).catch((error: unknown) => {
    if (submitted) update({
      epochError: error instanceof Error ? error.message : "Epoch execution interrupted",
      eta: "Delivery unconfirmed",
    });
    throw error;
  });
  record({
    ...accounts,
    status: "message_observed",
    eta: "1-3 min",
    sourceTxHash: result.sourceTxHash,
    midenTxId: route.mode === "send" ? result.midenNoteId : undefined,
    epochIntentNonce: result.intentNonce,
    epochSponsor: result.sponsorAddress,
    receivedAmount: result.outputAmount,
  });
}

function intentMonitor(): ActivityMonitor {
  return {
    canPoll: (activity) =>
      activity.status !== "complete" &&
      activity.status !== "failed" &&
      Boolean(activity.epochSponsor && (activity.epochIntentNonce ||
        (activity.mode === "receive" && activity.sourceTxHash && !activity.epochDepositConfirmed))),
    async observe(activity) {
      const route = activityRoute(activity);
      if (!route) throw new Error("Missing Epoch route recovery data.");
      // Allocation may fail after the deposit, before solveIntent returns its
      // nonce. The source receipt remains independently verifiable on reload.
      if (!activity.epochIntentNonce && route.mode === "receive" && activity.sourceTxHash) {
        const { evm, chain } = epochRouteAssets(route);
        const client = createPublicClient({ chain, transport: evmReadTransport(evm.network) });
        const receipt = await findTransactionReceipt(client, activity.sourceTxHash as Hex);
        return {
          patch: receipt?.status === "reverted"
            ? { status: "failed", failureLeg: "source", eta: "Deposit reverted" }
            : receipt
              ? { epochDepositConfirmed: true, eta: "Delivery unconfirmed" }
              : {},
          warning: activity.epochError,
        };
      }
      const { getEpochReadOnlySdk } = await import("./sdk");
      const destinationChainId = route.mode === "receive" ? MIDEN_DESTINATION_CHAIN_ID : epochRouteAssets(route).chain.id;
      const sdk = await getEpochReadOnlySdk(activity.epochSponsor as `0x${string}`, route.recovery);
      const statuses = await sdk.getIntentStatus(
        activity.epochSponsor!,
        activity.epochIntentNonce!,
      );
      const state = epochActivityState(statuses, destinationChainId);
      const destinationTxHash = epochDestinationTx(statuses, destinationChainId);
      return {
        patch: {
          ...state,
          destinationTxHash,
          midenTxId: activity.mode === "receive" ? destinationTxHash : undefined,
        },
      };
    },
  };
}
