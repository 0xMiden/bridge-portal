import type { ProviderFlows } from "../../core/provider";
import { parseUnits } from "viem";
import { ensureSepolia } from "../../../wallets/evm/evm-wallet";
import { midenAccountLink } from "../../miden-account-link";
import {
  AGGLAYER_TESTNET,
  buildSepoliaDepositTransaction,
  normalizeMidenAccountHex,
} from "./agglayer";

import type { AgglayerDepositStatus } from "./agglayer";
import { findMidenToEvmDeposit } from "./agglayer-status";
import {
  agglayerPatch,
  type ChainTxObservation,
  type AgglayerObservation,
} from "./activity-observation";
async function sourceTransaction(hash: string, signal: AbortSignal): Promise<ChainTxObservation> {
  const response = await fetch(`/api/evm/sepolia/transaction?hash=${encodeURIComponent(hash)}`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error("Unable to read Sepolia transaction.");
  return response.json();
}

export const flows: ProviderFlows = {
  receive: {
    async quote() {
      return null;
    },
    async submit({ input, phase, record }) {
      const { provider, address } = input.evmWallet;
      if (!provider || !address) throw new Error("Connect your Ethereum wallet.");
      const destination = input.midenAccount;
      if (!destination)
        throw new Error("Connect Bread or paste a Miden account ID before receiving.");
      await ensureSepolia(provider);
      const transaction = buildSepoliaDepositTransaction({
        amountEth: input.amount,
        midenAccountId: normalizeMidenAccountHex(destination),
      });
      phase("Confirm in your wallet…");
      const sourceTxHash = await provider.request<string>({
        method: "eth_sendTransaction",
        params: [
          {
            from: address,
            to: transaction.to,
            data: transaction.data,
            value: transaction.value,
            gas: transaction.gas,
          },
        ],
      });
      record({
        status: "source_finality",
        eta: "10-20 min",
        destination,
        sourceTxHash,
        bridgeDestinationAddress: transaction.destinationAddress,
        midenAccountHex: midenAccountLink(destination),
        sourceNetworkId: AGGLAYER_TESTNET.sourceNetworkId,
        destinationNetworkId: AGGLAYER_TESTNET.destinationNetworkId,
      });
    },
    monitor: {
      canPoll: (activity) =>
        activity.status !== "failed" &&
        !(activity.status === "complete" && activity.midenTxId) &&
        Boolean(activity.bridgeDestinationAddress || activity.sourceTxHash),
      async observe(activity, signal) {
        const observation: AgglayerObservation = {};
        // Source and indexer are independent. A temporary outage must not discard the other's evidence.
        const results = await Promise.allSettled([
          activity.status !== "complete" && activity.sourceTxHash
            ? sourceTransaction(activity.sourceTxHash, signal).then((tx) => {
                observation.sourceTx = tx;
              })
            : Promise.resolve(),
          activity.bridgeDestinationAddress
            ? (async () => {
                const response = await fetch(
                  `/api/agglayer/deposits?destinationAddress=${encodeURIComponent(activity.bridgeDestinationAddress!)}`,
                  { signal },
                );
                if (!response.ok) throw new Error("Unable to read Agglayer deposits.");
                const status: AgglayerDepositStatus = await response.json();
                observation.deposit = activity.sourceTxHash
                  ? (status.deposits.find(
                      (deposit) =>
                        deposit.tx_hash?.toLowerCase() === activity.sourceTxHash?.toLowerCase(),
                    ) ?? null)
                  : status.latestDeposit;
              })()
            : Promise.resolve(),
        ]);
        const errors = results.filter((result) => result.status === "rejected");
        if (errors.length === results.length) throw errors[0].reason;
        return {
          patch: agglayerPatch(activity, observation),
          warning: errors.length
            ? "Some chain observations are unavailable. Tracking will retry."
            : undefined,
        };
      },
    },
  },
  send: {
    async quote() {
      return null;
    },
    async submit({ input, phase, record }) {
      const wallet = input.midenWallet;
      if (!wallet.requestTransaction || !wallet.waitForTransaction || !wallet.address)
        throw new Error("Connect your Bread wallet before bridging out to Sepolia.");
      const destination = input.evmAddress;
      if (!/^0x[0-9a-fA-F]{40}$/.test(destination))
        throw new Error("Enter a valid Sepolia (0x…) destination, or connect your Sepolia wallet.");
      if (!input.midenAsset)
        throw new Error('Tap "Show balance" first so we can detect the Miden ETH you\'re sending.');
      const amount = parseUnits(input.amount, input.midenAsset.decimals);
      if (amount <= 0n) throw new Error("Enter an amount greater than zero.");
      phase("Confirm in your wallet…");
      const { runAgglayerSend } = await import("./agglayer-execute");
      const { txHash } = await runAgglayerSend({
        amount,
        faucetId: input.midenAsset.faucetId,
        destinationAddress: destination,
        senderAddress: wallet.address,
        requestTransaction: wallet.requestTransaction,
        waitForTransaction: wallet.waitForTransaction,
      });
      record({
        status: "source_finality",
        eta: "10-20 min",
        destination,
        midenTxId: txHash,
        sourceNetworkId: AGGLAYER_TESTNET.destinationNetworkId,
        destinationNetworkId: AGGLAYER_TESTNET.sourceNetworkId,
      });
    },
    monitor: {
      canPoll: (activity) =>
        activity.status !== "complete" &&
        activity.status !== "failed" &&
        Boolean(activity.destination),
      async observe(activity, signal) {
        if (activity.status === "claim_submitted" && activity.claimTxHash) {
          const destinationTx = await sourceTransaction(activity.claimTxHash, signal);
          return {
            patch: agglayerPatch(activity, { destinationTx }),
          };
        }
        const deposit = await findMidenToEvmDeposit(
          activity.destination!,
          activity.depositCount,
          signal,
        );
        if (!deposit) return { patch: {} };
        return {
          patch: agglayerPatch(activity, {
            deposit,
          }),
        };
      },
    },
  },
};
