import { formatUnits } from "viem";
import type { ActivityMonitor } from "../../core/provider";
import { nearPost, notifyNearDeposit } from "./client";
import { nearStatusResponseSchema } from "./schema";
import { nearReceiptAssets, nearTrackingInput, verifySignedNearQuote, validateNearTxHash } from "./quote";
import { observeNearEvmSource } from "./evm-source";
import { awaitsNearDeposit, missingNearSettlement } from "./operation";

export const nearMonitor: ActivityMonitor = {
  canPoll: (activity, refresh) => {
    const { near } = activity;
    if (!near || near.submission === "declined" || near.submission === "not_sent") return false;
    if (near.status === "SUCCESS") return !near.statusUpdatedAt || Boolean(refresh && missingNearSettlement(activity));
    return near.status !== "REFUNDED" && near.status !== "FAILED";
  },
  observe: async (activity, signal) => {
    if (!activity.near || !activity.routeId) return { patch: {} };
    const operation = activity.near;
    const body = { routeId: activity.routeId, quote: operation.quote };
    try {
      const status = nearStatusResponseSchema.parse(await nearPost("status", body, signal));
      const pair = nearReceiptAssets(body.routeId, body.quote);
      verifySignedNearQuote(status.quoteResponse, nearTrackingInput(body.routeId, body.quote, pair), false, false);
      if (status.quoteResponse.signature !== body.quote.signature) throw new Error("Quote reference mismatch.");
      for (const tx of status.swapDetails.originChainTxHashes) validateNearTxHash(pair.source, tx.hash);
      for (const tx of status.swapDetails.destinationChainTxHashes) validateNearTxHash(pair.destination, tx.hash);
      const waiting = awaitsNearDeposit(status.status);
      // A refund may also appear on the origin chain. Only a single deposit is unambiguous.
      const funded = status.status === "PROCESSING" || status.status === "SUCCESS";
      const singleDeposit = status.status !== "REFUNDED" && status.swapDetails.originChainTxHashes.length === 1;
      // A Miden origin hash in 1Click identifies a note. Only Bread supplies its transaction ID.
      const detected = activity.mode === "receive" && singleDeposit && (!activity.sourceTxHash || funded)
        ? status.swapDetails.originChainTxHashes[0].hash : undefined;
      const sourceActivity = !activity.sourceTxHash && detected ? { ...activity, sourceTxHash: detected } : activity;
      const source = activity.mode === "receive" && waiting && awaitsNearDeposit(operation.status)
        ? await observeNearEvmSource(sourceActivity, signal) : { patch: {} };
      if (source.patch.failureLeg === "source") return { ...source, patch: { sourceTxHash: detected, ...source.patch } };
      // A pending receipt gets one delayed notification retry. Only status establishes delivery.
      const retryAt = operation.notificationRetryAt;
      const sourceHash = source.patch.sourceTxHash ?? activity.sourceTxHash;
      const depositHash = activity.mode === "send" ? activity.midenNoteId : sourceHash;
      // The note ID is saved before the wallet prompt. Wait for the source transaction before notifying.
      const notification = status.status === "PENDING_DEPOSIT" && operation.status === "PENDING_DEPOSIT" && sourceHash && depositHash &&
        operation.notification === "pending" && retryAt !== null && (retryAt ?? 0) <= Date.now()
        ? await notifyNearDeposit({ ...body, txHash: depositHash }, null, signal) : undefined;
      const destinationTxHash = status.status === "SUCCESS" ? status.swapDetails.destinationChainTxHashes[0]?.hash : undefined;
      return { warning: source.warning, patch: {
        ...source.patch,
        sourceTxHash: source.patch.sourceTxHash ?? detected,
        destinationTxHash,
        midenTxId: activity.mode === "receive" ? destinationTxHash : undefined,
        receivedAmount: status.status === "SUCCESS" && status.swapDetails.amountOut !== undefined
          ? formatUnits(BigInt(status.swapDetails.amountOut), pair.destination.decimals) : undefined,
        near: { ...(source.patch.near ?? operation), ...notification, status: status.status, statusUpdatedAt: status.updatedAt,
          originTxHashes: status.swapDetails.originChainTxHashes.map(tx => tx.hash),
          destinationTxHashes: status.swapDetails.destinationChainTxHashes.map(tx => tx.hash),
          submission: !waiting && status.status !== "FAILED" ? "confirmed" : source.patch.near?.submission ?? operation.submission,
          refundedAmount: status.swapDetails.refundedAmount
            ? formatUnits(BigInt(status.swapDetails.refundedAmount), pair.source.decimals) : undefined,
          refundReason: status.swapDetails.refundReason },
      } };
    } catch (error) {
      signal.throwIfAborted();
      // Independent chain evidence remains available when 1Click cannot return a valid status.
      const source = activity.mode === "receive" && awaitsNearDeposit(operation.status)
        ? await observeNearEvmSource(activity, signal) : { patch: {} };
      if (source.patch.failureLeg === "source") return source;
      return { patch: source.patch,
        warning: operation.status === "SUCCESS" ? "Delivery was confirmed. The settled amount could not be refreshed."
          : `${error instanceof Error ? error.message : "NEAR status is unavailable."} Transfer remains pending. Retry here; do not send another deposit.` };
    }
  },
};
