import { activityStartedAt } from "../../bridge/core/rules";
import { presentActivity } from "../../bridge/providers/activity-presentation";
import { directionFor } from "../../bridge/providers/registry";
import {
  type Activity,
  destinationExplorer,
  sourceExplorer,
  quoteForActivity,
  statusLabel,
  statusTone,
  providerFee,
} from "./bridge-presentation";

export type ActivityDetailModel = ReturnType<typeof activityDetailFor>;

export function activityDetailFor(activity: Activity) {
  const presentation = presentActivity(activity);
  const receiptActivity = { ...activity, status: presentation.status };
  const complete = presentation.status === "complete";
  const untracked = presentation.progress.kind === "manual";
  const delivered = complete && directionFor(activity).consumeNote;
  const label = delivered ? "Delivered" : untracked ? presentation.headline : statusLabel(presentation.status);
  const quote = quoteForActivity(receiptActivity);
  const details = directionFor(activity).activityDetails(activity);
  return {
    receipt: {
      activity: receiptActivity,
      receivedAmount: quote.expectedReceived,
      networkFee: quote.networkFee,
      sepoliaGasUnits: quote.fees.sepoliaGasUnits,
      fee:
        details.fee === undefined
          ? { label: quote.fees.label, value: quote.bridgeFee }
          : providerFee(quote.fees, details.fee, activity.asset, quote.asset),
      receivedLabel: activity.cctpHelper ? "At least" : complete
        ? "Received"
        : quote.fees.estimated
          ? "Estimated received"
          : "Expected",
      tracked: !untracked,
      sourceLink: sourceExplorer(receiptActivity),
      destinationLink: destinationExplorer(receiptActivity),
      sourceHash: details.sourceHash,
      destinationHash: presentation.destination.hash,
      destinationKind: presentation.destination.kind,
      sourceTxAt: activityStartedAt(activity),
      destinationTxAt: presentation.destination.at,
      pending: !complete,
      status: complete && !delivered ? undefined : { label, tone: statusTone(presentation.status, activity) },
    },
    announcement: untracked || delivered ? presentation.headline : `${label}. ${presentation.headline}`,
    progress: presentation.progress,
    guidance: presentation.guidance,
    canCopyDiagnostics: !complete,
  };
}
