import { formatUnits } from "viem";
import type { ProviderDirection } from "../../core/provider";
import { MANUAL_PENDING, MANUAL_WARNING } from "./helper-types";
export const manualHelperDirection: ProviderDirection = {
  steps: [], tracking: "manual", consumeNote: false, pollMs: 12_000, phaseFields: ["status", "cctpHelper"],
  resolvePhase: activity => activity.cctpHelper?.stage ?? "reviewed",
  phases: {
    reviewed: { order: 0, status: "signature", headline: "Review the manual Solana transfer" },
    signing: { order: 0, status: "signature", headline: "Confirm in Phantom (Solana)", message: "Keep the original tab open. Do not start another burn." },
    signed: { order: 1, status: "source_finality", headline: "Signed source transaction saved", message: "Only the saved transaction may be sent. Do not start another burn." },
    source_unknown: { order: 2, status: "source_finality", headline: "Waiting for finalized Solana source evidence", message: "Source outcome is not yet resolved. Check this attempt; do not burn again." },
    source_finalized: { order: 3, status: "source_finality", headline: "Waiting for Circle attestation", message: MANUAL_PENDING },
    needs_attention: { order: 2, status: "source_finality", headline: "Manual deposit needs attention", message: "Source or attestation validation is unresolved. Keep the saved evidence; do not burn again." },
    ready: { order: 4, status: "source_finality", headline: "Ready for manual Arc execution", message: MANUAL_PENDING },
    source_failed: { order: 4, status: "failed", headline: "Solana transaction failed at finality", message: "The failed source transaction did not commit a burn. A new transfer requires a new explicit review." },
  },
  fees: () => ({ charging: "deducted", denomination: "source", requiresQuote: true, label: "Maximum CCTP fee", estimated: false, output: "unquoted",
    eta: "Manual Arc execution required", showEta: false, networkFee: "SOL transaction fee and Circle event-account rent; separate Arc gas", bridgeFee: "Current Standard fee cap", warning: MANUAL_WARNING, sepoliaGasUnits: null }),
  activityDetails: activity => ({ sourceHash: activity.cctpHelper?.signature, destinationKind: "tx",
    received: activity.cctpHelper ? formatUnits(BigInt(activity.cctpHelper.authorization.minimumNet), 6) : undefined,
    fee: activity.cctpHelper ? formatUnits(BigInt(activity.cctpHelper.authorization.maxCctpFee), 6) : undefined }),
};
