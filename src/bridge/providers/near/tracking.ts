import { formatUnits } from "viem";
import type { ActivityMonitor } from "../../core/provider";
import { nearPost } from "./client";
import { nearStatusResponseSchema } from "./schema";
import { nearReceiptAssets, nearTrackingInput, verifySignedNearQuote, validateNearTxHash } from "./quote";
import { observeNearEvmSource } from "./evm-source";

export const nearMonitor: ActivityMonitor = {
  canPoll: ({ near }) => Boolean(near && near.submission !== "declined" && near.submission !== "not_sent" && (
    near.status === "SUCCESS" ? !near.statusUpdatedAt : near.status !== "REFUNDED" && near.status !== "FAILED"
  )),
  observe: async (activity, signal) => {
    if (!activity.near || !activity.routeId) return { patch: {} };
    const operation = activity.near;
    const body = { routeId: activity.routeId, quote: operation.quote };
    let notification = operation.notification;
    try {
      const status = nearStatusResponseSchema.parse(await nearPost("status", body, signal));
      const pair = nearReceiptAssets(body.routeId, body.quote);
      verifySignedNearQuote(status.quoteResponse, nearTrackingInput(body.routeId, body.quote, pair), false, false);
      if (status.quoteResponse.signature !== body.quote.signature) throw new Error("Quote reference mismatch.");
      for (const tx of status.swapDetails.originChainTxHashes) validateNearTxHash(pair.source, tx.hash);
      for (const tx of status.swapDetails.destinationChainTxHashes) validateNearTxHash(pair.destination, tx.hash);
      const source = activity.mode === "receive" && status.status === "PENDING_DEPOSIT"
        ? await observeNearEvmSource(activity, signal) : { patch: {} };
      if (source.patch.failureLeg === "source") return source;
      // Detection is authoritative. Retry the optional notification silently
      // until NEAR detects the deposit.
      if (status.status === "PENDING_DEPOSIT" && activity.sourceTxHash && notification === "pending") {
        try { await nearPost("deposit/submit", { ...body, txHash: source.patch.sourceTxHash ?? activity.sourceTxHash }, signal); notification = "sent"; }
        catch { signal.throwIfAborted(); }
      }
      // A refund can add origin-chain hashes; retain them without mislabelling a refund as the deposit.
      const funded = status.status === "PROCESSING" || status.status === "SUCCESS";
      const [origin] = status.swapDetails.originChainTxHashes;
      const singleDeposit = status.status !== "REFUNDED" && status.swapDetails.originChainTxHashes.length === 1;
      const detected = singleDeposit && (!activity.sourceTxHash || (activity.mode === "receive" && funded)) ? origin.hash : undefined;
      const destinationTxHash = status.status === "SUCCESS" ? status.swapDetails.destinationChainTxHashes[0]?.hash : undefined;
      return { warning: source.warning, patch: {
        ...source.patch,
        sourceTxHash: source.patch.sourceTxHash ?? detected,
        destinationTxHash,
        midenTxId: activity.mode === "receive" ? destinationTxHash : undefined,
        receivedAmount: status.status === "SUCCESS" && status.swapDetails.amountOut !== undefined
          ? formatUnits(BigInt(status.swapDetails.amountOut), pair.destination.decimals) : undefined,
        near: { ...operation, notification, status: status.status, statusUpdatedAt: status.updatedAt,
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
        warning: operation.status === "SUCCESS" ? "Delivery was confirmed. The settled amount could not be refreshed."
          : `${error instanceof Error ? error.message : "NEAR status is unavailable."} Transfer remains pending. Retry here; do not send another deposit.` };
    }
  },
};
