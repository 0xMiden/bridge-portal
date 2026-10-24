import { activityPhase, type Provider, type ProviderDirections } from "../../core/provider";
import type { BridgeRoute } from "../../core/routes";
import { evmNetworks } from "../../../config/evm-networks";
import { recoveryGuidance } from "../../core/activity-presentation";

const phases = {
  signature: {
    status: "signature",
    order: 0,
    headline: "Confirm in your wallet",
  },
  source_finality: {
    status: "source_finality",
    order: 1,
    headline: "Waiting for confirmation",
  },
  message_observed: {
    status: "message_observed",
    order: 2,
    headline: "A solver is filling your intent",
  },
  claim_available: {
    status: "message_observed",
    order: 2,
    headline: "A solver is filling your intent",
  },
  claim_submitted: {
    status: "message_observed",
    order: 2,
    headline: "A solver is filling your intent",
  },
  failed: {
    status: "failed",
    order: 5,
    headline: "This transfer needs attention",
    guidance: recoveryGuidance,
  },
} as const;

const fees = {
  charging: "included",
  requiresQuote: true,
  label: "Provider fee",
  estimated: false,
  output: "unquoted",
  eta: "1-3 min",
  showEta: true,
  bridgeFee: "In quoted rate",
  sepoliaGasUnits: 150000,
} as const;

function quoteFees(route?: BridgeRoute) {
  const evm = route?.mode === "send" ? route.destination : route?.source;
  return {
    ...fees,
    networkFee: evm && evm.kind !== "miden" ? `${evmNetworks[evm.network].name} gas` : "Network gas",
    warning: route?.recovery.environment === "mainnet"
      ? "A live quote is required for this amount. Check the output before confirming."
      : "Epoch uses mock tokens on Sepolia. Check the quoted output before confirming.",
  };
}

const directions = {
  send: {
    activityDetails: (activity) => ({
      sourceHash: activity.sourceTxHash ?? activity.midenTxId,
      destinationHash: activity.claimTxHash ?? activity.destinationTxHash,
      destinationKind: "tx",
      received: activity.receivedAmount,
    }),
    steps: [
      {
        status: "signature",
        label: "Sign Miden note",
        detail: "Approve the collateral note in your Bread wallet.",
      },
      {
        status: "source_finality",
        label: "Miden confirmation",
        detail: "Your collateral note confirms on Miden.",
      },
      {
        status: "message_observed",
        label: "Solver filling on the destination network",
        detail: "A solver claimed your note and is paying out {asset} on the destination network.",
      },
      {
        status: "complete",
        label: "Transfer settled",
        detail: "{asset} delivered to your destination address.",
      },
    ],
    phases: {
      ...phases,
      complete: {
        status: "complete",
        order: 5,
        headline: "Funds delivered",
      },
    },
    phaseFields: ["status", "failureLeg"],
    resolvePhase: activityPhase,
    consumeNote: false,
    tracking: "automatic",
    pollMs: 5000,
    fees: (route) => ({
      ...quoteFees(route),
      sepoliaGasUnits: null,
      networkFee: "In quoted rate",
    }),
  },
  receive: {
    activityDetails: (activity) => ({
      sourceHash: activity.sourceTxHash,
      destinationHash: activity.midenTxId ?? activity.destinationTxHash,
      destinationKind: "tx",
      received: activity.receivedAmount,
      reference: activity.epochClaimHash ? { label: "Epoch claim hash", value: activity.epochClaimHash } : undefined,
    }),
    steps: [
      {
        status: "signature",
        label: "Sign the deposit",
        detail: "Approve the deposit in your Ethereum wallet.",
      },
      {
        status: "source_finality",
        label: "Deposit confirmation",
        detail: "The deposit confirms on the source network.",
      },
      {
        status: "message_observed",
        label: "Solver filling on Miden",
        detail: "A solver picked up your intent and is delivering {asset} to your Miden account.",
      },
      {
        status: "complete",
        label: "Delivered on Miden",
        detail: "{asset} is in your Miden account.",
      },
    ],
    phases: {
      ...phases,
      allocation_pending: {
        status: "source_finality",
        order: 1,
        headline: "Deposit confirmed; delivery unconfirmed",
        guidance: {
          tone: "active",
          icon: "alert",
          title: "Keep this receipt",
          body: "Your deposit confirmed on the source network. Delivery on Miden has not been confirmed. Do not send the deposit again. Share this receipt’s diagnostics with Epoch support if delivery remains unconfirmed.",
        },
      },
      complete: {
        status: "complete",
        order: 5,
        headline: "Delivered on Miden",
      },
    },
    phaseFields: ["status", "failureLeg", "epochDepositConfirmed"],
    resolvePhase: (activity) => activity.status === "source_finality" && activity.epochDepositConfirmed
      ? "allocation_pending" : activityPhase(activity),
    consumeNote: false,
    tracking: "automatic",
    pollMs: 5000,
    fees: quoteFees,
  },
} satisfies ProviderDirections;

export const epoch: Provider = {
  label: "Epoch",
  badge: "Fast",
  unavailableReason: "Epoch does not currently quote the reverse direction for this token pair.",
  directions,
  load: () => import("./flows"),
};
