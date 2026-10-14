import { activityState } from "../activity";
import { activityRoute } from "../core/routes";
import { activityStartedAt } from "../core/rules";
import {
  type ProviderActivityPresentation,
  trackedProgress,
} from "../core/activity-presentation";
import { directionFor } from "./registry";
import type { BridgeActivity } from "../core/models";

/** Provider data is rendered through the same path for every direction. */
export function presentActivity(activity: BridgeActivity): ProviderActivityPresentation {
  const direction = directionFor(activity);
  const state = activityState(activity);
  const details = direction.activityDetails(activity);
  const asset = activityRoute(activity)?.destination.symbol ?? activity.asset;
  const headline = state.headline.replaceAll("{asset}", asset);
  const destination = {
    hash: details.destinationHash,
    kind: details.destinationKind,
    at: activity.destinationTxAt,
  };
  if (direction.tracking === "manual")
    return {
      status: state.status,
      headline,
      destination,
      guidance: state.guidance ?? null,
      progress: {
        kind: "manual",
        message: state.message ?? headline,
        reference: details.reference,
      },
    };
  const progress = trackedProgress(
    {
      status: state.status,
      failureLeg: state.failureLeg ?? activity.failureLeg,
    },
    direction.steps.map((step) => ({ ...step, detail: step.detail.replaceAll("{asset}", asset) })),
    { consumeNote: direction.consumeNote },
  );
  progress.canRefresh = progress.live;
  progress.deliveryWarningAt =
    progress.live && direction.deliveryWarningMs
      ? activityStartedAt(activity) + direction.deliveryWarningMs
      : undefined;
  progress.midenBlock = progress.complete ? details.destinationBlock : undefined;
  return {
    status: state.status,
    headline,
    destination,
    progress,
    guidance: state.guidance ?? null,
  };
}
