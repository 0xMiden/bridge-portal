import { SEPOLIA_NETWORK } from "../../../config/sepolia";
import { MIDEN_DESTINATION_CHAIN_ID } from "./config";
import { epochActivityState, epochDestinationTx } from "./epoch-status";
import type { SubmissionContext } from "../../core/submission";
import type { ActivityMonitor, ProviderFlows } from "../../core/provider";
import { ensureSepolia } from "../../../wallets/evm/evm-wallet";
import { midenAccountLink } from "../../miden-account-link";

const phaseLabels: Record<string, string> = {
  starting: "Preparing your Epoch deposit…",
  "switching-chain": "Switch to Sepolia in your wallet…",
  "preparing-transaction": "Preparing your Epoch deposit…",
  "waiting-for-transaction": "Confirming your deposit on Sepolia…",
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
      await ensureSepolia(provider);
      await execute(context, context.input.midenAccount);
    },
    monitor: intentMonitor(MIDEN_DESTINATION_CHAIN_ID),
  },
  send: {
    async quote(input) {
      const { quoteEpochSend } = await import("./epoch-quote");
      return quoteEpochSend(input);
    },
    async submit(context) {
      if (!/^0x[0-9a-fA-F]{40}$/.test(context.input.evmAddress))
        throw new Error("Enter a valid Sepolia (0x…) address, or connect your Sepolia wallet.");
      await execute(context, context.input.evmAddress);
    },
    monitor: intentMonitor(SEPOLIA_NETWORK.chainId),
  },
};
async function execute(
  { input, route, phase, record, update }: SubmissionContext,
  destination: string,
) {
  phase("Confirm in your wallet…");
  const { runEpochTransfer } = await import("./epoch-execute");
  const accounts = {
    destination,
    midenAccount: input.midenAccount,
    evmAddress: input.evmAddress,
    midenAccountHex: route.mode === "receive" ? midenAccountLink(destination) : undefined,
    epochSponsor: input.evmAddress,
  };
  const result = await runEpochTransfer({
    route,
    amount: input.amount,
    midenAccount: input.midenAccount,
    evmAddress: input.evmAddress,
    requestTransaction: input.midenWallet.requestTransaction,
    waitForTransaction: input.midenWallet.waitForTransaction,
    onSubmitted: ({ sourceTxHash, midenNoteId }) =>
      record({
        ...accounts,
        status: "source_finality",
        sourceTxHash,
        midenTxId: midenNoteId,
      }),
    onStatus: (observation) => {
      const message = phaseLabels[observation.phase] ?? "Working…";
      phase(message);
      update({ eta: message });
    },
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

function intentMonitor(destinationChainId: number): ActivityMonitor {
  return {
    canPoll: (activity) =>
      activity.status !== "complete" &&
      activity.status !== "failed" &&
      Boolean(activity.epochSponsor && activity.epochIntentNonce),
    async observe(activity) {
      const { getEpochReadOnlySdk } = await import("./sdk");
      const sdk = await getEpochReadOnlySdk(activity.epochSponsor as `0x${string}`);
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
