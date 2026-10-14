import { activityPhase, type Provider, type ProviderDirections } from "../../core/provider";
import { recoveryGuidance, consumeNoteGuidance } from "../../core/activity-presentation";

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
    headline: "The bridge is processing",
  },
  claim_available: {
    status: "claim_available",
    order: 3,
    headline: "Ready to claim on Sepolia",
  },
  claim_submitted: {
    status: "claim_submitted",
    order: 4,
    headline: "Confirming on Sepolia",
  },
  failed: {
    status: "failed",
    order: 5,
    headline: "This transfer needs attention",
    guidance: recoveryGuidance,
  },
} as const;

const fees = {
  charging: "none",
  requiresQuote: false,
  label: "Provider fee",
  estimated: false,
  output: "exact",
  eta: "10-20 min",
  showEta: true,
  networkFee: "Sepolia gas",
  bridgeFee: "No provider fee",
  warning: "Agglayer is configured as a testnet route.",
  sepoliaGasUnits: 140000,
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
        detail: "Approve the outbound note in your Bread wallet.",
      },
      {
        status: "source_finality",
        label: "Miden confirmation",
        detail: "The note confirms on Miden before the bridge picks it up.",
      },
      {
        status: "message_observed",
        label: "Building the proof",
        detail: "The bridge burned your asset and is proving the exit for Sepolia.",
      },
      {
        status: "claim_available",
        label: "Ready to claim on Sepolia",
        detail: "The exit is proven and claimable — it's auto-claimed for you, no action needed.",
      },
      {
        status: "claim_submitted",
        label: "Claim confirming",
        detail: "The Sepolia claim is confirming.",
      },
      {
        status: "complete",
        label: "Settled on Sepolia",
        detail: "Funds released to your Sepolia address.",
      },
    ],
    phases: {
      ...phases,
      complete: {
        status: "complete",
        order: 5,
        headline: "Funds released on Sepolia",
      },
      claim_available: {
        ...phases.claim_available,
        guidance: {
          tone: "active",
          icon: "wallet",
          title: "Auto-claimed on Sepolia",
          body: "The exit is claimed on Sepolia for you automatically. Keep this page open or check back later — no manual claim is required.",
        },
      },
      claim_submitted: {
        ...phases.claim_submitted,
        guidance: {
          tone: "active",
          icon: "wallet",
          title: "Auto-claimed on Sepolia",
          body: "The exit is claimed on Sepolia for you automatically. Keep this page open or check back later — no manual claim is required.",
        },
      },
    },
    phaseFields: ["status", "failureLeg"],
    resolvePhase: activityPhase,
    consumeNote: false,
    tracking: "automatic",
    pollMs: 6000,
    fees: () => ({
      ...fees,
      sepoliaGasUnits: 260000,
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
        detail: "The deposit confirms on Sepolia and reaches finality.",
      },
      {
        status: "message_observed",
        label: "Observed by the bridge",
        detail: "The bridge registered your deposit and is preparing the Miden note.",
      },
      {
        status: "complete",
        label: "Delivered on Miden",
        detail: "The note is created on Miden — consume it in your wallet to update your balance.",
      },
    ],
    phases: {
      ...phases,
      complete: {
        status: "complete",
        order: 5,
        headline: "Delivered on Miden — claim in your wallet",
        guidance: consumeNoteGuidance,
      },
      claim_available: {
        ...phases.claim_available,
        guidance: consumeNoteGuidance,
      },
    },
    phaseFields: ["status", "failureLeg"],
    resolvePhase: activityPhase,
    consumeNote: true,
    tracking: "automatic",
    pollMs: 6000,
    fees: () => fees,
  },
} satisfies ProviderDirections;

export const agglayer: Provider = {
  label: "Agglayer",
  badge: "Testnet",
  unavailableReason: "Agglayer withdrawals are not available yet",
  directions,
  load: () => import("./flows"),
};
