import { formatUnits } from "viem";
import type { BridgeActivity } from "../../core/models";
import type { Provider, ProviderDirections } from "../../core/provider";
import { recoveryGuidance, consumeNoteGuidance } from "../../core/activity-presentation";

const depositPhases = {
  "awaiting-signature": {
    status: "signature",
    order: 0,
    headline: "Confirm in your wallet",
  },
  confirming: {
    status: "source_finality",
    order: 1,
    headline: "Waiting for deposit confirmation",
  },
  forwarding: {
    status: "source_finality",
    order: 2,
    headline: "Circle is forwarding your USDC",
  },
  "awaiting-attestation": {
    status: "source_finality",
    order: 3,
    headline: "Waiting for Circle attestation",
  },
  "awaiting-delivery": {
    status: "message_observed",
    order: 4,
    headline: "Circle attested — waiting for Miden delivery",
  },
  delivered: {
    status: "complete",
    order: 5,
    headline: "Delivered on Miden — claim in your wallet",
    guidance: consumeNoteGuidance,
  },
  cancelled: {
    status: "failed",
    order: 5,
    headline: "Deposit cancelled in your wallet",
    failureLeg: "source",
  },
  replaced: {
    status: "failed",
    order: 5,
    headline: "Deposit replaced by another transaction",
    failureLeg: "source",
  },
  reverted: {
    status: "failed",
    order: 5,
    headline: "Deposit reverted",
    failureLeg: "source",
    guidance: recoveryGuidance,
  },
  failed: {
    status: "failed",
    order: 5,
    headline: "Deposit needs attention",
    guidance: recoveryGuidance,
  },
} as const;

const manualPayoutMessage =
  "Check your destination wallet for the USDC payout. Automatic withdrawal tracking is not available yet.";

const depositFees = {
  charging: "none",
  requiresQuote: false,
  label: "Circle fee",
  estimated: false,
  output: "exact",
  eta: "Delivery time varies",
  showEta: false,
  networkFee: "Arc gas (USDC)",
  bridgeFee: "Maximum 0 USDC",
  warning: "Keep some USDC on Arc for gas. Consume the delivered USDCx note in Bread.",
  sepoliaGasUnits: null,
} as const;

const directions = {
  receive: {
    activityDetails: (activity) => ({
      sourceHash: activity.sourceTxHash,
      destinationHash: activity.xreserveNoteId,
      destinationKind: "note",
      received: activity.receivedAmount,
      fee:
        activity.xreserveFee === undefined
          ? undefined
          : formatUnits(BigInt(activity.xreserveFee), 6),
      destinationBlock: activity.xreserveMidenBlock,
    }),
    steps: [
      {
        status: "signature",
        label: "Sign USDC deposit",
        detail: "Approve USDC and confirm the deposit in your origin wallet.",
      },
      {
        status: "source_finality",
        label: "Circle confirmation and attestation",
        detail: "Circle forwards your USDC to xReserve and attests the Miden deposit.",
      },
      {
        status: "message_observed",
        label: "Delivering USDCx on Miden",
        detail: "Circle attested the deposit. The relayer is creating your USDCx note.",
      },
      {
        status: "complete",
        label: "USDCx note delivered",
        detail: "The exact note is included on Miden. Consume it in Bread to update your balance.",
      },
    ],
    phases: depositPhases,
    phaseFields: ["status", "xreserveStatus", "xreserveForwarding", "failureLeg"],
    resolvePhase: resolveXreserveDepositState,
    consumeNote: true,
    tracking: "automatic",
    pollMs: 12000,
    deliveryWarningMs: 15 * 60000,
    fees: (route) =>
      !route || route.source.network === "arc-testnet"
        ? depositFees
        : {
            ...depositFees,
            charging: "additional",
            requiresQuote: true,
            label: "Circle fee",
            networkFee: "Gas in ETH",
            bridgeFee: "Circle forwarding fee",
            warning: "Consume the delivered USDCx note in Bread.",
          },
  },
  send: {
    activityDetails: (activity) => ({
      sourceHash: activity.sourceTxHash,
      destinationHash: activity.destinationTxHash,
      destinationKind: "tx",
      received:
        activity.receivedAmount ??
        (activity.xreserveWithdrawalReceivedEstimate === undefined
          ? undefined
          : formatUnits(BigInt(activity.xreserveWithdrawalReceivedEstimate), 6)),
      fee:
        activity.xreserveWithdrawalFeeEstimate === undefined
          ? undefined
          : formatUnits(BigInt(activity.xreserveWithdrawalFeeEstimate), 6),
      reference: activity.xreserveNoteId
        ? { label: "Burn note ID", value: activity.xreserveNoteId }
        : undefined,
    }),
    steps: [],
    phases: {
      signature: {
        status: "signature",
        order: 0,
        headline: "Confirm in your wallet",
        message: manualPayoutMessage,
      },
      submitted: {
        status: "source_finality",
        order: 1,
        headline: "Withdrawal submitted",
        message: manualPayoutMessage,
      },
      complete: {
        status: "complete",
        order: 5,
        headline: "USDC delivered",
        message: "Funds are available in your destination wallet.",
      },
      discarded: {
        status: "failed",
        order: 5,
        headline: "Withdrawal note needs attention",
        message:
          "Miden discarded the burn note. Copy diagnostics and contact support before retrying.",
      },
      failed: {
        status: "failed",
        order: 5,
        headline: "Withdrawal needs attention",
        message: "Check your wallet for the transaction details before trying again.",
      },
    },
    phaseFields: ["status", "xreserveBurnStatus", "failureLeg"],
    resolvePhase: (activity) => {
      if (activity.status === "complete") return "complete";
      if (activity.xreserveBurnStatus === "discarded") return "discarded";
      if (activity.status === "failed") return "failed";
      return activity.xreserveNoteId || activity.sourceTxHash ? "submitted" : "signature";
    },
    consumeNote: false,
    tracking: "manual",
    pollMs: 12000,
    fees: () => ({
      ...depositFees,
      charging: "deducted",
      requiresQuote: true,
      label: "Estimated Circle fee",
      estimated: true,
      output: "unquoted",
      networkFee: "Miden fee (USDCx)",
      bridgeFee: "Deducted from payout by Circle",
      warning:
        "Burning USDCx is irreversible. The estimated payout uses Circle’s current fee; the final fee can change after the burn. Keep USDCx for the Miden network fee. Check your destination wallet for the USDC payout.",
    }),
  },
} satisfies ProviderDirections;

type XreserveDepositState = keyof typeof depositPhases;

/**
 * Reconcile saved observations before rendering:
 * - Delivery is terminal and cannot regress to an older observation.
 * - Specific source outcomes explain a generic failure; failure beats stale progress.
 * - Attestation and confirmation supersede forwarding; a broadcast supersedes signature.
 * No note id or attestation alone proves delivery. Legacy complete rows remain settled.
 */
function resolveXreserveDepositState(activity: BridgeActivity): XreserveDepositState {
  if (activity.status === "complete" || activity.xreserveStatus === "delivered") return "delivered";
  const observed = activity.xreserveStatus;
  if (observed === "cancelled" || observed === "replaced" || observed === "reverted")
    return observed;
  if (activity.status === "failed") return "failed";
  if (observed === "attested") return "awaiting-delivery";
  if (observed === "confirmed") return "awaiting-attestation";
  // Old activities may have only the shared lifecycle status.
  if (!observed && activity.status === "message_observed") return "awaiting-delivery";
  if (activity.xreserveForwarding) return "forwarding";
  if (observed === "submitted" || activity.sourceTxHash) return "confirming";
  return activity.status === "signature" ? "awaiting-signature" : "confirming";
}

export const xreserve: Provider = {
  label: "USDCx",
  badge: "Testnet",
  directions,
  load: () => import("./flows"),
};
