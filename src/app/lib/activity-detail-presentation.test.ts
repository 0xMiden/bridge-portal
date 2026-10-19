import { expect, test } from "vitest";
import { DEMO_ACTIVITIES } from "./activity-demo";
import { activityDetailFor } from "./activity-detail-presentation";
test("a failed destination on a receive route marks delivery processing failed", () => {
  const { progress } = activityDetailFor({ ...DEMO_ACTIVITIES["demo-agglayer-receive"], status: "failed", failureLeg: "destination" });
  if (progress.kind !== "tracked") throw new Error("Expected tracked progress");
  expect(progress.milestones.filter((step) => step.state === "failed").map((step) => step.status)).toEqual(["message_observed"]);
  expect(progress.milestones.find((step) => step.status === "complete")?.state).toBe("upcoming");
});
test("the recorded failure leg determines the failed milestone", () => {
  const { progress } = activityDetailFor({
    ...DEMO_ACTIVITIES["demo-agglayer-send"],
    status: "failed",
    failureLeg: "destination",
    eta: "Transfer stopped",
  });
  if (progress.kind !== "tracked") throw new Error("Expected tracked progress");
  expect(progress.milestones.find((step) => step.state === "failed")?.status).toBe(
    "claim_submitted",
  );
});
test("a receipt leaves an unknown delivery time blank even when it has a transaction hash", () => {
  const activity = { ...DEMO_ACTIVITIES["demo-agglayer-receive"], destinationTxAt: undefined };
  const model = activityDetailFor(activity);
  expect(model.receipt.destinationHash).toBeTruthy();
  expect(model.receipt.destinationTxAt).toBeUndefined();
  expect(activityDetailFor({ ...activity, destinationTxAt: 1_700_000_100_000 }).receipt.destinationTxAt)
    .toBe(1_700_000_100_000);
});
test.each(["agglayer", "xreserve"] as const)(
  "%s delivery does not assert an unverified wallet claim is pending",
  (provider) => {
    const model = activityDetailFor({ ...DEMO_ACTIVITIES["demo-agglayer-receive"], provider });
    if (model.progress.kind !== "tracked") throw new Error("Expected tracked progress");
    expect(model.receipt.pending).toBe(false);
    expect(model.progress.live).toBe(false);
    expect(model.progress.milestones.find((step) => step.status === "complete")?.state).toBe(
      "done",
    );
    expect(model.progress.milestones.find((step) => step.status === "consume")?.state).toBe(
      "unknown",
    );
    expect(model.guidance).toBeNull();
    expect(model.receipt.status?.label).toBe("Delivered");
  },
);
test("an untracked withdrawal exposes its note without a refresh or delivery timeline", () => {
  const model = activityDetailFor({
    ...DEMO_ACTIVITIES["demo-epoch-send"],
    provider: "xreserve",
    status: "source_finality",
    xreserveNoteId: "burn-note",
  });
  expect(model.progress).toMatchObject({ kind: "manual", reference: { label: "Burn note ID", value: "burn-note" } });
  expect(model.receipt.status?.label).toBe("Withdrawal submitted");
  expect(model.guidance).toBeNull();
  expect(model.canCopyDiagnostics).toBe(true);
});
test.each(["cancelled", "replaced"] as const)(
  "a %s deposit never suggests starting another transfer",
  (xreserveStatus) => {
    const model = activityDetailFor({
      ...DEMO_ACTIVITIES["demo-agglayer-receive"],
      provider: "xreserve",
      status: "failed",
      xreserveStatus,
    });
    expect(model.guidance).toBeNull();
    if (model.progress.kind !== "tracked") throw new Error("Expected tracked progress");
    expect(model.progress.canRefresh).toBe(false);
    expect(model.progress.live).toBe(false);
  },
);
test("resolved xReserve delivery updates receipt, announcement, and support actions together", () => {
  const model = activityDetailFor({
    ...DEMO_ACTIVITIES["demo-agglayer-receive"],
    provider: "xreserve",
    asset: "USDC",
    status: "failed",
    xreserveStatus: "delivered",
  });
  expect(model.receipt.pending).toBe(false);
  expect(model.receipt.status?.label).toBe("Delivered");
  expect(model.receipt.activity.status).toBe("complete");
  expect(model.announcement).toBe("Delivered on Miden");
  expect(model.canCopyDiagnostics).toBe(false);
});
