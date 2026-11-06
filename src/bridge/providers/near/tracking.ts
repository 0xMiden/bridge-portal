import { formatUnits } from "viem";
import type { ActivityMonitor } from "../../core/provider";
import { nearPost } from "./client";
import { nearStatusResponseSchema } from "./schema";
import { nearRouteAssets, nearTrackingInput, verifyNearQuote } from "./quote";
import { observeNearEvmSource } from "./evm-source";

export const nearMonitor: ActivityMonitor = {
  canPoll: activity => Boolean(activity.near && !["SUCCESS", "REFUNDED", "FAILED"].includes(activity.near.status)),
  observe: async (activity, signal) => {
    if (!activity.near || !activity.routeId) return { patch: {} };
    const operation = activity.near;
    const body = { routeId: activity.routeId, quote: operation.quote };
    let notification = operation.notification;
    let warning: string | undefined;
    try {
      const status = nearStatusResponseSchema.parse(await nearPost("status", body, signal));
      verifyNearQuote(status.quoteResponse, nearTrackingInput(body.routeId, body.quote), false, false);
      if (status.quoteResponse.signature !== body.quote.signature) throw new Error("Quote reference mismatch.");
      const source = activity.mode === "receive" && status.status === "PENDING_DEPOSIT"
        ? await observeNearEvmSource(activity, signal) : { patch: {} };
      if (source.patch.failureLeg === "source") return source;
      // Detection is authoritative; an optional hint must not delay settlement
      // or leave a retry warning on an already delivered/refunded receipt.
      if (status.status === "PENDING_DEPOSIT" && activity.sourceTxHash && notification === "pending") {
        try { await nearPost("deposit/submit", { ...body, txHash: source.patch.sourceTxHash ?? activity.sourceTxHash }, signal); notification = "sent"; }
        catch { signal.throwIfAborted(); warning = "Deposit notification is delayed. Status tracking will retry; do not send another deposit."; }
      }
      const pair = nearRouteAssets(body.routeId);
      // A refund can add origin-chain hashes; retain them without mislabelling a refund as the deposit.
      const sourceTxHash = source.patch.sourceTxHash ?? activity.sourceTxHash ?? (status.status !== "REFUNDED" && status.swapDetails.originChainTxHashes.length === 1
        ? status.swapDetails.originChainTxHashes[0].hash : undefined);
      return { warning: warning ?? source.warning, patch: {
        ...source.patch,
        sourceTxHash,
        destinationTxHash: status.status === "SUCCESS" ? status.swapDetails.destinationChainTxHashes[0]?.hash : undefined,
        midenTxId: activity.mode === "receive" && status.status === "SUCCESS" ? status.swapDetails.destinationChainTxHashes[0]?.hash : undefined,
        receivedAmount: status.status === "SUCCESS" && status.swapDetails.amountOut
          ? formatUnits(BigInt(status.swapDetails.amountOut), pair.destination.decimals) : undefined,
        near: { ...operation, notification, status: status.status,
          originTxHashes: status.swapDetails.originChainTxHashes.map(tx => tx.hash),
          destinationTxHashes: status.swapDetails.destinationChainTxHashes.map(tx => tx.hash),
          submission: status.swapDetails.originChainTxHashes.length ? "confirmed" : source.patch.near?.submission ?? operation.submission,
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
