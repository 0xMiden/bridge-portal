import { formatUnits } from "viem";
import type { ProviderDirection } from "../../core/provider";
import { evmNetworks } from "../../../config/evm-networks";
import { MANUAL_WARNING, MANUAL_PENDING } from "./helper-types";
export const evmManualHelperDirection: ProviderDirection = {
  steps: [], tracking: "manual", consumeNote: false, pollMs: 12_000, phaseFields: ["status", "cctpEvmHelper"],
  resolvePhase: activity => activity.cctpEvmHelper?.stage ?? "wallet_pending",
  phases: {
    wallet_pending: { order: 0, status: "signature", headline: "Source wallet request saved", message: "The wallet may have submitted this request. Recover this attempt; do not burn again." },
    source_unknown: { order: 1, status: "source_finality", headline: "Source outcome is unresolved", message: "Keep this receipt and the source wallet transaction hash. Do not start another burn." },
    source_finalized: { order: 2, status: "source_finality", headline: "Waiting for Circle Standard attestation", message: MANUAL_PENDING },
    needs_attention: { order: 1, status: "source_finality", headline: "Manual deposit needs attention", message: "Source or attestation validation is unresolved. Recover this attempt; do not burn again." },
    ready: { order: 3, status: "source_finality", headline: "Ready for manual Arc execution", message: MANUAL_PENDING },
    source_failed: { order: 3, status: "failed", headline: "Source transaction failed at finality", message: "The exact source transaction reverted in a finalized block. A new transfer requires a new review." },
  },
  fees: route => ({ charging: "deducted", denomination: "source", requiresQuote: true, label: "Maximum CCTP fee", estimated: false,
    output: "unquoted", eta: "Circle Standard finality, then manual Arc execution", showEta: false,
    networkFee: route && route.source.kind === "erc20" ? `Source gas in ${evmNetworks[route.source.network].nativeCurrency.symbol}; separate Arc gas` : "Source gas; separate Arc gas",
    bridgeFee: "Current Standard fee cap", warning: MANUAL_WARNING, sepoliaGasUnits: null }),
  activityDetails: activity => ({ sourceHash: activity.cctpEvmHelper?.hash, destinationKind: "tx",
    received: activity.cctpEvmHelper ? formatUnits(BigInt(activity.cctpEvmHelper.authorization.minimumNet), 6) : undefined,
    fee: activity.cctpEvmHelper ? formatUnits(BigInt(activity.cctpEvmHelper.authorization.maxCctpFee), 6) : undefined }),
};
