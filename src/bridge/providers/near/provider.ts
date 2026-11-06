import type { Provider, ProviderDirection } from "../../core/provider";
import { evmNetworks } from "../../../config/evm-networks";

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
    networkFee: activity.near?.networkFee,
    refund: activity.near?.status === "REFUNDED" && activity.near.refundedAmount ? `${activity.near.refundedAmount} ${activity.asset}` : undefined,
    reference: activity.near ? { label: "NEAR quote reference", value: activity.near.quote.correlationId } : undefined,
  }),
  fees: () => ({
    charging: "included", requiresQuote: true, label: "Provider fee", estimated: false, output: "unquoted",
    eta: "Quoted live", showEta: true, networkFee: "Miden fee (USDCx)", bridgeFee: "Included in quoted rate",
    warning: "Review the executable quote, minimum received and destination token before confirming.", sepoliaGasUnits: null,
  }),
};

const receive: ProviderDirection = {
  ...send,
  steps: [
    { status: "signature", label: "Sign EVM deposit", detail: "Confirm the deposit in your source wallet." },
    { status: "source_finality", label: "Deposit confirmation", detail: "Waiting for the EVM deposit to be detected." },
    { status: "message_observed", label: "Delivery to Miden", detail: "NEAR Intents is delivering {asset} to your Miden account." },
    { status: "complete", label: "Delivered on Miden", detail: "Check Bread for your {asset}." },
  ],
  phases: {
    ...send.phases,
    signature: { ...send.phases.signature, guidance: { ...guidance, body: "Confirm the deposit in your EVM wallet. Keep this receipt to track delivery to Miden." } },
    PENDING_DEPOSIT: { ...send.phases.PENDING_DEPOSIT, headline: "Waiting for the EVM deposit", guidance: {
      ...guidance, body: "Check the deposit in your EVM wallet and retry its status here. Do not send another deposit for this quote.",
    } },
    KNOWN_DEPOSIT_TX: { ...send.phases.KNOWN_DEPOSIT_TX, headline: "EVM deposit detected" },
    SUCCESS: { ...send.phases.SUCCESS, headline: "Delivered on Miden" },
    REFUNDED: { ...send.phases.REFUNDED, headline: "Funds refunded to your EVM wallet", guidance: {
      tone: "success", icon: "wallet", title: "Refunded to your EVM wallet",
      body: "The swap was refunded to your original EVM address. No Miden delivery was completed. Check your source wallet; provider fees may apply.",
    } },
    FAILED: { ...send.phases.FAILED, guidance: { ...guidance, body: "Check the deposit in your EVM wallet and share this receipt with support. Do not send another deposit for this quote." } },
  },
  fees: route => ({ ...send.fees(route), networkFee: route?.source.kind !== "miden" && route?.source
    ? `${evmNetworks[route.source.network].name} gas` : "Source network gas",
    sepoliaGasUnits: route?.source.kind === "native" ? 21_000 : 65_000 }),
};

export const near: Provider = {
  label: "NEAR Intents", badge: "Intent", unavailableReason: "NEAR Intents does not support this token pair.",
  directions: { send, receive }, load: () => import("./flows"),
};
