import type { Provider, ProviderDirection } from "../../core/provider";

const guidance = { tone: "active", icon: "alert", title: "Keep this receipt",
  body: "Check this transfer in Bread and retry its status here. Do not send another deposit for this quote." } as const;

const send: ProviderDirection = {
  steps: [
    { status: "signature", label: "Sign Miden deposit", detail: "Approve a public deposit note in Bread." },
    { status: "source_finality", label: "Miden confirmation", detail: "Waiting for the deposit to be detected." },
    { status: "message_observed", label: "Swap processing", detail: "NEAR Intents is delivering {asset}." },
    { status: "complete", label: "Funds delivered", detail: "{asset} delivered to your EVM address." },
  ],
  phases: {
    signature: { order: 0, status: "signature", headline: "Confirm in your wallet", guidance },
    PENDING_DEPOSIT: { order: 1, status: "source_finality", headline: "Waiting for the Miden deposit", guidance },
    KNOWN_DEPOSIT_TX: { order: 2, status: "source_finality", headline: "Miden deposit detected" },
    INCOMPLETE_DEPOSIT: { order: 2, status: "source_finality", headline: "Deposit needs attention", guidance: {
      ...guidance, body: "NEAR received less than the required deposit. Keep this receipt and contact support about recovery. Do not send an additional deposit from this portal.",
    } },
    PROCESSING: { order: 3, status: "message_observed", headline: "NEAR Intents is processing your transfer" },
    SUCCESS: { order: 4, status: "complete", headline: "Funds delivered" },
    REFUNDED: { order: 4, status: "refunded", headline: "Funds refunded to Miden", guidance: {
      tone: "success", icon: "wallet", title: "Refunded to Miden",
      body: "The swap was refunded to your original Miden account. No EVM delivery was completed. Check Bread for the refund; provider fees may apply.",
    } },
    FAILED: { order: 4, status: "failed", headline: "Transfer needs recovery", guidance },
  },
  phaseFields: ["status"],
  resolvePhase: activity => activity.near?.submission === "prepared" && activity.near.status === "PENDING_DEPOSIT" ? "signature" : activity.near?.status ?? "signature",
  consumeNote: false, tracking: "automatic", pollMs: 5_000,
  activityDetails: activity => ({
    sourceHash: activity.sourceTxHash, destinationHash: activity.near?.status === "SUCCESS" ? activity.destinationTxHash : undefined,
    destinationKind: "tx", received: activity.near?.status === "REFUNDED" ? "0" : activity.receivedAmount,
    reference: activity.near ? { label: "NEAR quote reference", value: activity.near.quote.correlationId } : undefined,
  }),
  fees: () => ({
    charging: "included", requiresQuote: true, label: "Provider fee", estimated: false, output: "unquoted",
    eta: "Quoted live", showEta: true, networkFee: "Miden fee (USDCx)", bridgeFee: "Included in quoted rate",
    warning: "Review the executable quote, minimum received and destination token before confirming.", sepoliaGasUnits: null,
  }),
};

export const near: Provider = {
  label: "NEAR Intents", badge: "Intent", unavailableReason: "NEAR Intents currently supports Send from Miden only.",
  directions: { send, receive: send }, load: () => import("./flows"),
};
