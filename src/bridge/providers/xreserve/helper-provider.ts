import { formatUnits } from "viem";
import type { ProviderDirection } from "../../core/provider";
import { MANUAL_PENDING, AUTOMATIC_HELPER_WARNING } from "./helper-types";
import { consumeNoteGuidance } from "../../core/activity-presentation";
export const manualHelperDirection: ProviderDirection = {
  steps: [
    { status: "signature", label: "Sign source burn", detail: "Review the fixed recipient and confirm in Phantom." },
    { status: "source_finality", label: "Source finality and Arc execution", detail: "Circle attests the burn; a sponsor submits the fixed helper call when available." },
    { status: "message_observed", label: "Miden note delivery", detail: "Wait for the exact recipient note from the existing reserve relayer." },
    { status: "complete", label: "Delivered on Miden", detail: "The exact note is included. Consume it in Bread to use the funds." },
  ], tracking: "automatic", consumeNote: true, pollMs: 12_000, phaseFields: ["status", "cctpHelper"],
  resolvePhase: activity => {
    const helper = activity.cctpHelper;
    if (helper?.completion?.needsAttention) return helper.completion.arc ? "reserve_review" : "execution_review";
    return helper?.stage ?? "reviewed";
  },
  phases: {
    reviewed: { order: 0, status: "signature", headline: "Review the Solana transfer" },
    signing: { order: 0, status: "signature", headline: "Confirm in Phantom (Solana)", message: "Keep the original tab open. Do not start another burn." },
    signed: { order: 1, status: "source_finality", headline: "Signed source transaction saved", message: "Only the saved transaction may be sent. Do not start another burn." },
    source_unknown: { order: 2, status: "source_finality", headline: "Waiting for finalized Solana source evidence", message: "Source outcome is not yet resolved. Check this attempt; do not burn again." },
    source_finalized: { order: 3, status: "source_finality", headline: "Waiting for Circle attestation", message: MANUAL_PENDING },
    needs_attention: { order: 2, status: "source_finality", headline: "Deposit needs attention", message: "Source or attestation validation is unresolved. Keep the saved evidence; do not burn again." },
    ready: { order: 4, status: "source_finality", headline: "Waiting for Arc execution", message: MANUAL_PENDING },
    attested: { order: 4, status: "source_finality", headline: "Waiting for Arc execution", message: "A sponsor may submit the helper call. No Arc wallet is needed for sponsored execution; timing and funding are not guaranteed." },
    arc_deposited: { order: 5, status: "message_observed", headline: "Deposited on Arc; waiting for reserve authorization" },
    reserve_attested: { order: 6, status: "message_observed", headline: "Reserve authorized; waiting for the exact Miden note" },
    delivered: { order: 7, status: "complete", headline: "Delivered on Miden", guidance: consumeNoteGuidance },
    execution_review: { order: 4, status: "source_finality", headline: "Arc completion evidence needs review" },
    reserve_review: { order: 6, status: "message_observed", headline: "Reserve authorization needs review" },
    source_failed: { order: 4, status: "failed", headline: "Solana transaction failed at finality", message: "The failed source transaction did not commit a burn. A new transfer requires a new explicit review." },
  },
  fees: () => ({ charging: "deducted", denomination: "source", requiresQuote: true, label: "Maximum CCTP fee", estimated: false, output: "unquoted",
    eta: "Waiting for sponsorship and network finality", showEta: false, networkFee: "SOL transaction fee and Circle event-account rent; sponsor pays Arc gas when available", bridgeFee: "Current Standard fee cap", warning: AUTOMATIC_HELPER_WARNING, sepoliaGasUnits: null }),
  activityDetails: activity => ({ sourceHash: activity.cctpHelper?.signature, destinationKind: "note", destinationHash: activity.xreserveNoteId,
    destinationBlock: activity.xreserveMidenBlock,
    received: activity.cctpHelper ? formatUnits(BigInt(activity.cctpHelper.bundle?.netAmount ?? activity.cctpHelper.authorization.minimumNet), 6) : undefined,
    fee: activity.cctpHelper ? formatUnits(BigInt(activity.cctpHelper.bundle?.feeExecuted ?? activity.cctpHelper.authorization.maxCctpFee), 6) : undefined }),
};
