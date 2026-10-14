import type { ActivityStatus } from "./activity-status";
import type { BridgeActivity } from "./models";

export type ActivityStep = {
  status: Exclude<ActivityStatus, "failed">;
  label: string;
  detail: string;
};

export type Milestone = {
  status: ActivityStatus | "consume";
  label: string;
  detail: string;
  state: "done" | "current" | "upcoming" | "failed";
};

export type ActivityProgress =
  | {
      kind: "manual";
      message: string;
      reference?: { label: string; value: string };
    }
  | {
      kind: "tracked";
      milestones: Milestone[];
      complete: boolean;
      live: boolean;
      canRefresh: boolean;
      deliveryWarningAt?: number;
      midenBlock?: number;
    };

export type ActivityGuidance = {
  tone: "danger" | "success" | "active";
  icon: "alert" | "wallet";
  title: string;
  body: string;
  steps?: string[];
  newTransfer?: boolean;
};

export type ProviderActivityPresentation = {
  /** Effective lifecycle status used consistently by receipt and progress. */
  status: ActivityStatus;
  headline: string;
  progress: ActivityProgress;
  guidance: ActivityGuidance | null;
  destination: {
    kind: "tx" | "note";
    hash?: string;
    at?: number;
  };
};

export function trackedProgress(
  activity: Pick<BridgeActivity, "status" | "failureLeg">,
  steps: readonly ActivityStep[],
  {
    consumeNote = false,
  }: {
    consumeNote?: boolean;
  } = {},
): Extract<
  ActivityProgress,
  {
    kind: "tracked";
  }
> {
  const currentIndex = steps.findIndex((step) => step.status === activity.status);
  const failureLeg = activity.failureLeg ?? "source";
  const failedStatus =
    failureLeg === "source"
      ? "source_finality"
      : steps.some((step) => step.status === "claim_submitted")
        ? "claim_submitted"
        : "message_observed";
  const failedIndex = steps.findIndex((step) => step.status === failedStatus);
  const milestones: Milestone[] = steps.map((step, index) => {
    if (activity.status === "complete") return { ...step, state: "done" };
    const isFailed = activity.status === "failed";
    const activeIndex = isFailed ? failedIndex : currentIndex;
    if (index < activeIndex) return { ...step, state: "done" };
    if (index > activeIndex) return { ...step, state: "upcoming" };
    return { ...step, state: isFailed ? "failed" : "current" };
  });
  if (consumeNote)
    milestones.push({
      status: "consume",
      label: "Consume note in your wallet",
      detail:
        "Balance updates only after you claim the note in Bread — this happens in your wallet, not here.",
      state:
        activity.status === "complete" || activity.status === "claim_available"
          ? "current"
          : "upcoming",
    });
  return {
    kind: "tracked",
    milestones,
    complete: activity.status === "complete",
    live: activity.status !== "complete" && activity.status !== "failed",
    canRefresh: false,
  };
}

export const recoveryGuidance: ActivityGuidance = {
  tone: "danger",
  icon: "alert",
  title: "Recover this transfer",
  newTransfer: true,
  body: "Automatic retry isn't available for a bridge transfer once it's broadcast. Start a fresh transfer for the same amount, or copy a diagnostic bundle and share it with support.",
  steps: [
    "Check the source and destination explorers below to see how far the funds moved.",
    "Start a new transfer, or copy diagnostics and contact support.",
  ],
};

export const consumeNoteGuidance: ActivityGuidance = {
  tone: "success",
  icon: "wallet",
  title: "Claim the note in your wallet",
  body: "The note is on Miden. Your wallet balance updates only after you consume it.",
  steps: [
    "Open your Bread (Miden) wallet.",
    "Go to Activities → Claim pending notes.",
    "Consume the note to move the funds into your balance.",
  ],
};
