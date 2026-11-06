import { formatUnits } from "viem";
import type { ActivityMonitor } from "../../core/provider";
import { nearPost } from "./client";
import { nearStatusResponseSchema } from "./schema";
import { nearPair, nearTrackingInput, verifyNearQuote } from "./quote";

export const nearMonitor: ActivityMonitor = {
  canPoll: activity => Boolean(activity.near && !["SUCCESS", "REFUNDED", "FAILED"].includes(activity.near.status)),
  observe: async (activity, signal) => {
    if (!activity.near || !activity.routeId) return { patch: {} };
    const operation = activity.near;
    const body = { routeId: activity.routeId, quote: operation.quote };
    let notification = operation.notification;
    let warning: string | undefined;
    if (activity.sourceTxHash && notification === "pending") {
      try { await nearPost("deposit/submit", { ...body, txHash: activity.sourceTxHash }, signal); notification = "sent"; }
      catch { warning = "Deposit notification is delayed. Status tracking will retry; do not send another deposit."; }
    }
    try {
      const status = nearStatusResponseSchema.parse(await nearPost("status", body, signal));
      verifyNearQuote(status.quoteResponse, nearTrackingInput(body.routeId, body.quote), false, false);
      if (status.quoteResponse.signature !== body.quote.signature) throw new Error("Quote reference mismatch.");
      const pair = nearPair(body.routeId);
      const sourceTxHash = activity.sourceTxHash ?? status.swapDetails.originChainTxHashes[0]?.hash;
      return { warning, patch: {
        sourceTxHash,
        destinationTxHash: status.status === "SUCCESS" ? status.swapDetails.destinationChainTxHashes[0]?.hash : undefined,
        receivedAmount: status.status === "SUCCESS" && status.swapDetails.amountOut
          ? formatUnits(BigInt(status.swapDetails.amountOut), pair.destination.decimals) : undefined,
        near: { ...operation, notification, status: status.status,
          submission: sourceTxHash ? "confirmed" : operation.submission,
          refundedAmount: status.swapDetails.refundedAmount
            ? formatUnits(BigInt(status.swapDetails.refundedAmount), pair.source.decimals) : undefined,
          refundReason: status.swapDetails.refundReason },
      } };
    } catch (error) {
      signal.throwIfAborted();
      return { patch: { near: { ...operation, notification } },
        warning: `${error instanceof Error ? error.message : "NEAR status is unavailable."} Transfer remains pending. Retry here; do not send another deposit.` };
    }
  },
};
