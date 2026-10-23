import { configKey } from "../../../config/bridge-config";
import type { ProviderFlows } from "../../core/provider";
import { captureSourceTransaction } from "../../evm/source-transaction";
import { evmNetworks } from "../../../config/evm-networks";
import { midenAccountLink } from "../../miden-account-link";
import { isCctpNetwork } from "./config";
import { fetchWithdrawalQuote } from "./withdrawal-quote";

import { observeXreserveDeposit } from "./status";

export const flows: ProviderFlows = {
  receive: {
    async quote(input, signal) {
      if (["arc-testnet", "arc"].includes(input.route.source.network)) return null;
      const { quoteTransfer } = await import("./cctp-quote");
      return quoteTransfer(input, signal);
    },
    async submit({ input, route, phase, record, update }) {
      const { provider, address } = input.evmWallet;
      if (!provider || !address) throw new Error("Connect your Ethereum wallet.");
      const recipient = input.midenAccount;
      if (!recipient)
        throw new Error("Connect your Bread wallet or paste a Miden account to receive into.");
      const { depositOnArc } = await import("./deposit");
      const sourceName =
        route.source.kind === "miden" ? "Miden" : evmNetworks[route.source.network].name;
      const labels = {
        checking: "Checking deposit…",
        approving: "Approve USDC in your wallet…",
        "approving-wallet-fees": "Fee suggestions unavailable. Review your wallet’s fee estimate before approving USDC…",
        "approval-confirming": `Confirming USDC approval on ${sourceName}…`,
        depositing: "Confirm the deposit in your wallet…",
        "depositing-wallet-fees": "Fee suggestions unavailable. Review your wallet’s fee estimate before confirming the deposit…",
      };
      const request: Parameters<typeof depositOnArc>[0] = {
        provider,
        account: address as `0x${string}`,
        amount: input.amount,
        recipient,
        onPhase: (value) => phase(labels[value]),
        onBroadcast: (sourceTxHash: string, fee?: string) => {
          record({
            status: "source_finality",
            xreserveStatus: "submitted",
            xreserveFee: fee,
            sourceTxHash,
            destination: recipient,
            midenAccountHex: midenAccountLink(recipient),
            evmAddress: address,
            midenAccount: recipient,
            receivedAmount: input.amount.trim(),
          });
          if (route.source.kind !== "miden")
            void captureSourceTransaction(route.source.network, sourceTxHash)
              .then((sourceTransaction) => {
                if (sourceTransaction) update({ sourceTransaction });
              })
              .catch(() => undefined);
        },
      };
      if (["arc-testnet", "arc"].includes(route.source.network)) await depositOnArc(request, route.recovery);
      else {
        if (!isCctpNetwork(route.source.network) || input.quote?.kind !== "cctp")
          throw new Error("Review the Circle fee before sending.");
        const { depositViaCctp } = await import("./cctp-deposit");
        await depositViaCctp({
          ...request,
          network: route.source.network,
          quote: input.quote.authorization,
        }, route.recovery);
      }
    },
    monitor: {
      canPoll: (activity) =>
        activity.status !== "complete" &&
        activity.status !== "failed" &&
        Boolean(activity.sourceTxHash),
      observe: observeXreserveDeposit,
    },
  },
  send: {
    async quote(input, signal) {
      const { quoteTransfer } = await import("./withdrawal-quote");
      return quoteTransfer(input, signal);
    },
    async submit({ input, route, phase, record, update }) {
      const wallet = input.midenWallet;
      if (!wallet.requestTransaction || !wallet.waitForTransaction || !wallet.address)
        throw new Error("Connect your Bread wallet to sign the withdrawal.");
      const recipient = input.evmAddress;
      phase("Checking withdrawal and preparing burn note…");
      const reviewed = input.quote?.kind === "withdrawal" ? input.quote.authorization : undefined;
      if (
        !reviewed ||
        reviewed.network !== route.destination.network ||
        configKey(reviewed.recovery) !== configKey(route.recovery) ||
        reviewed.amount !== input.amount ||
        reviewed.sender !== wallet.address ||
        reviewed.recipient.toLowerCase() !== recipient.toLowerCase() ||
        reviewed.expiresAt <= Date.now()
      ) {
        throw new Error("Refresh and review the withdrawal estimate before sending.");
      }
      const fresh = await fetchWithdrawalQuote({
        recovery: route.recovery,
        network: route.destination.network,
        amount: input.amount,
        sender: wallet.address,
        recipient,
      });
      if (BigInt(fresh.fee) > BigInt(reviewed.fee))
        throw new Error(
          "Circle's estimated withdrawal fee increased. Review the updated estimate before sending.",
        );
      const { withdrawUsdcx } = await import("./withdrawal-execute");
      const result = await withdrawUsdcx({
        amount: input.amount,
        network: route.destination.network,
        destination: recipient,
        sender: wallet.address,
        requestTransaction: wallet.requestTransaction,
        waitForTransaction: wallet.waitForTransaction,
        onSubmitted: (noteId, requestId) =>
          record({
            status: "source_finality",
            xreserveBurnStatus: "pending",
            xreserveNoteId: noteId,
            xreserveWalletRequestId: requestId,
            destination: recipient,
            evmAddress: recipient,
            midenAccount: wallet.address,
            xreserveWithdrawalFeeEstimate: fresh.fee,
            xreserveWithdrawalReceivedEstimate: fresh.received,
          }),
      }, route.recovery);
      update({ sourceTxHash: result.txHash });
    },
    monitor: { canPoll: () => false, observe: async () => ({ patch: {} }) },
  },
};
