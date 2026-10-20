import type { BridgeEnvironment } from "../../../config/environment";
import type { FlowMode } from "../../core/models";
import { activityPhase, type Provider, type ProviderDirections } from "../../core/provider";
import { recoveryGuidance, consumeNoteGuidance } from "../../core/activity-presentation";

function makeDirections(network: "Sepolia" | "Ethereum") {
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
      headline: `Ready to claim on ${network}`,
    },
    claim_submitted: {
      status: "claim_submitted",
      order: 4,
      headline: `Confirming on ${network}`,
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
    networkFee: `${network} gas`,
    bridgeFee: "No provider fee",
    warning: network === "Sepolia" ? "Agglayer is configured as a testnet route." : "Consume delivered ETH notes in Bread.",
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
          detail: `The bridge burned your asset and is proving the exit for ${network}.`,
        },
        {
          status: "claim_available",
          label: `Ready to claim on ${network}`,
          detail: "The exit is proven and claimable — it's auto-claimed for you, no action needed.",
        },
        {
          status: "claim_submitted",
          label: "Claim confirming",
          detail: `The ${network} claim is confirming.`,
        },
        {
          status: "complete",
          label: `Settled on ${network}`,
          detail: `Funds released to your ${network} address.`,
        },
      ],
      phases: {
        ...phases,
        complete: {
          status: "complete",
          order: 5,
          headline: `Funds released on ${network}`,
        },
        claim_available: {
          ...phases.claim_available,
          guidance: {
            tone: "active",
            icon: "wallet",
            title: `Auto-claimed on ${network}`,
            body: `The exit is claimed on ${network} for you automatically. Keep this page open or check back later — no manual claim is required.`,
          },
        },
        claim_submitted: {
          ...phases.claim_submitted,
          guidance: {
            tone: "active",
            icon: "wallet",
            title: `Auto-claimed on ${network}`,
            body: `The exit is claimed on ${network} for you automatically. Keep this page open or check back later — no manual claim is required.`,
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
          label: `Sign ${network} deposit`,
          detail: "Approve the deposit in your Ethereum wallet.",
        },
        {
          status: "source_finality",
          label: `${network} confirmation`,
          detail: `The deposit confirms on ${network} and reaches finality.`,
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
          headline: "Delivered on Miden",
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

  return directions;
}

const testnetDirections = makeDirections("Sepolia");
const mainnetDirections = makeDirections("Ethereum");
export function agglayerDirection(mode: FlowMode, environment: BridgeEnvironment) {
  return (environment === "mainnet" ? mainnetDirections : testnetDirections)[mode];
}

export const agglayer: Provider = {
  label: "Agglayer",
  badge: "Testnet",
  directions: testnetDirections,
  load: () => import("./flows"),
};
