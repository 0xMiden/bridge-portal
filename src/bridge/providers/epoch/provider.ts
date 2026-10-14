import { activityPhase, type Provider, type ProviderDirections } from "../../core/provider";
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
  networkFee: "Sepolia gas",
  bridgeFee: "In quoted rate",
  warning: "Epoch is configured as a testnet route.",
  sepoliaGasUnits: 150000,
} as const;

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
        label: "Solver filling on Sepolia",
        detail: "A solver claimed your note and is paying out {asset} on Sepolia.",
      },
      {
        status: "complete",
        label: "Settled on Sepolia",
        detail: "{asset} delivered to your Sepolia address.",
      },
    ],
    phases: {
      ...phases,
      complete: {
        status: "complete",
        order: 5,
        headline: "Funds released on Sepolia",
      },
    },
    phaseFields: ["status", "failureLeg"],
    resolvePhase: activityPhase,
    consumeNote: false,
    tracking: "automatic",
    pollMs: 5000,
    fees: () => ({
      ...fees,
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
    }),
    steps: [
      {
        status: "signature",
        label: "Sign Sepolia deposit",
        detail: "Approve the deposit in your Ethereum wallet.",
      },
      {
        status: "source_finality",
        label: "Sepolia confirmation",
        detail: "The deposit confirms on Sepolia.",
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
      complete: {
        status: "complete",
        order: 5,
        headline: "Delivered on Miden",
      },
    },
    phaseFields: ["status", "failureLeg"],
    resolvePhase: activityPhase,
    consumeNote: false,
    tracking: "automatic",
    pollMs: 5000,
    fees: () => fees,
  },
} satisfies ProviderDirections;

export const epoch: Provider = {
  label: "Epoch",
  badge: "Paused",
  disabled: true,
  unavailableReason: "Paused in this build.",
  directions,
  load: () => import("./flows"),
};
