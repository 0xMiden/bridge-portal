import type { BridgeConfig } from "../../../config/bridge-config";
import type { ProviderFlows } from "../../core/provider";
import { parseUnits } from "viem";
import { activityRoute } from "../../core/routes";
import type { EvmNetwork } from "../../core/assets";
import { midenAccountLink } from "../../miden-account-link";
import {
  agglayerConfig,
} from "./agglayer";
import { submitAgglayerDeposit } from "./deposit";

import { chainObservationSchema, depositStatusSchema, withdrawalStatusSchema, type ChainTxObservation } from "./status-schema";
import type { Activity } from "../../core/models";
import { findMidenToEvmDeposit } from "./agglayer-status";
import {
  agglayerPatch,
  type AgglayerObservation,
} from "./activity-observation";
async function sourceTransaction(hash: string, signal: AbortSignal, network: EvmNetwork = "sepolia"): Promise<ChainTxObservation> {
  const response = await fetch(`/api/evm/${network}/transaction?hash=${encodeURIComponent(hash)}`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error("Unable to read the EVM transaction.");
  const observation = chainObservationSchema.parse(await response.json());
  if (observation.hash.toLowerCase() !== hash.toLowerCase()) throw new Error("EVM transaction mismatch.");
  return observation;
}

export const flows: ProviderFlows = {
  receive: {
    async quote() {
      return null;
    },
    async submit({ input, route, phase, record }) {
      const AGGLAYER_TESTNET = agglayerConfig(route.recovery);
      const { provider, address } = input.evmWallet;
      if (!provider || !address) throw new Error("Connect your Ethereum wallet.");
      const destination = input.midenAccount;
      if (!destination)
        throw new Error("Connect Bread or paste a Miden account ID before receiving.");
      const { sourceTxHash, destinationAddress } = await submitAgglayerDeposit({
        route, amount: input.amount, destination, provider, address, phase,
      });
      record({
        status: "source_finality",
        eta: "10-20 min",
        destination,
        sourceTxHash,
        bridgeDestinationAddress: destinationAddress,
        midenAccountHex: midenAccountLink(destination),
        sourceNetworkId: AGGLAYER_TESTNET.sourceNetworkId,
        destinationNetworkId: AGGLAYER_TESTNET.destinationNetworkId,
      });
    },
    monitor: {
      canPoll: (activity) =>
        needsReceiveTracking(activity) && Boolean(activity.bridgeDestinationAddress || activity.sourceTxHash),
      async observe(activity, signal) {
        const recovery = activityRoute(activity)?.recovery;
        const config = agglayerConfig(recovery);
        const observation: AgglayerObservation = {};
        // Source and indexer are independent. A temporary outage must not discard the other's evidence.
        const results = await Promise.allSettled([
          activity.status !== "complete" && activity.sourceTxHash
            ? sourceTransaction(activity.sourceTxHash, signal, config.evmNetwork).then((tx) => {
                observation.sourceTx = tx;
              })
            : Promise.resolve(),
          observeDeposit(activity, signal, recovery).then(deposit => { observation.deposit = deposit; }),
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
    async submit({ input, route, phase, record }) {
      const AGGLAYER_TESTNET = agglayerConfig(route.recovery);
      const wallet = input.midenWallet;
      if (!wallet.requestTransaction || !wallet.waitForTransaction || !wallet.address)
        throw new Error("Connect your Bread wallet before bridging out.");
      const destination = input.evmAddress;
      if (!/^0x[0-9a-fA-F]{40}$/.test(destination))
        throw new Error("Connect the destination EVM wallet.");
      if (!input.midenAsset)
        throw new Error('Tap "Show balance" first so we can detect the Miden ETH you\'re sending.');
      if (route.source.kind !== "miden" || input.midenAsset.faucetId.toLowerCase() !== route.source.faucetId.toLowerCase() ||
          input.midenAsset.decimals !== route.source.decimals)
        throw new Error("The Miden asset changed. Refresh your balance and review the transfer again.");
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
      }, route.recovery);
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
        const recovery = activityRoute(activity)?.recovery;
        let exitHashes = activity.agglayerExitHashes;
        if (!exitHashes?.length) {
          const hash = activity.midenTxId ?? activity.sourceTxHash;
          if (!hash) return { patch: {}, warning: "The Miden transaction ID is missing. This withdrawal cannot be matched yet." };
          const params = new URLSearchParams({ sourceTxHash: hash });
          const response = await fetch(`/api/agglayer/withdrawal?${params}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ recovery }), cache: "no-store", signal });
          if (!response.ok) throw new Error("Unable to recover the withdrawal's identity. Tracking will retry.");
          const recovered = withdrawalStatusSchema.parse(await response.json());
          exitHashes = recovered.exitHashes;
          if (!exitHashes.length) return { patch: {} };
        }
        if (!activity.destination) throw new Error("Withdrawal destination is missing.");
        const deposit = await findMidenToEvmDeposit(
          activity.destination,
          exitHashes,
          signal,
          recovery,
        );
        return {
          patch: { agglayerExitHashes: exitHashes, ...agglayerPatch(activity, { deposit }) },
        };
      },
    },
  },
};

function needsReceiveTracking(activity: Activity) {
  if (activity.status === "failed") return false;
  return !(activity.status === "complete" && activity.midenTxId);
}

async function observeDeposit(activity: Activity, signal: AbortSignal, recovery?: BridgeConfig) {
  if (!activity.bridgeDestinationAddress) return undefined;
  const params = new URLSearchParams({ destinationAddress: activity.bridgeDestinationAddress });
  if (activity.sourceTxHash) params.set("sourceTxHash", activity.sourceTxHash);
  const response = await fetch(`/api/agglayer/deposits?${params}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ recovery }), cache: "no-store", signal });
  if (!response.ok) throw new Error("Unable to read Agglayer deposits.");
  const status = depositStatusSchema.parse(await response.json());
  if (status.destinationAddress.toLowerCase() !== activity.bridgeDestinationAddress.toLowerCase())
    throw new Error("Agglayer deposit destination mismatch.");
  return activity.sourceTxHash
    ? status.deposits.find(deposit => deposit.tx_hash?.toLowerCase() === activity.sourceTxHash?.toLowerCase()) ?? null
    : status.latestDeposit;
}
