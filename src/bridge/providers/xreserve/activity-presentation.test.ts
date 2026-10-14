import { expect, test } from "vitest";
import { presentActivity } from "../activity-presentation";
import type { BridgeActivity } from "../../core/models";

const deposit: BridgeActivity = {
  id: "deposit",
  provider: "xreserve",
  mode: "receive",
  routeId: "xreserve-usdc-to-miden",
  amount: "1",
  asset: "USDC",
  status: "source_finality",
  updatedAt: 1,
};
test.each<{
  name: string;
  patch: Partial<BridgeActivity>;
  headline: string;
  live: boolean;
  complete: boolean;
  current: string;
  guidance: "wallet" | "alert" | null;
}>([
  {
    name: "completed delivery cannot regress to attestation",
    patch: { status: "complete", xreserveStatus: "attested" },
    headline: "Delivered on Miden — claim in your wallet",
    live: false,
    complete: true,
    current: "consume",
    guidance: "wallet",
  },
  {
    name: "failure beats stale attestation",
    patch: { status: "failed", xreserveStatus: "attested" },
    headline: "Deposit needs attention",
    live: false,
    complete: false,
    current: "source_finality",
    guidance: "alert",
  },
  {
    name: "forwarding is still in progress",
    patch: { xreserveStatus: "submitted", xreserveForwarding: true },
    headline: "Circle is forwarding your USDC",
    live: true,
    complete: false,
    current: "source_finality",
    guidance: null,
  },
  {
    name: "broadcast supersedes signature",
    patch: { status: "signature", sourceTxHash: "0xbroadcast" },
    headline: "Waiting for deposit confirmation",
    live: true,
    complete: false,
    current: "source_finality",
    guidance: null,
  },
  {
    name: "a predicted note id is not delivery",
    patch: { xreserveStatus: "attested", xreserveNoteId: "note" },
    headline: "Circle attested — waiting for Miden delivery",
    live: true,
    complete: false,
    current: "message_observed",
    guidance: null,
  },
  {
    name: "unknown failure is not a revert",
    patch: { status: "failed" },
    headline: "Deposit needs attention",
    live: false,
    complete: false,
    current: "source_finality",
    guidance: "alert",
  },
  {
    name: "known revert beats stale progress",
    patch: { xreserveStatus: "reverted" },
    headline: "Deposit reverted",
    live: false,
    complete: false,
    current: "source_finality",
    guidance: "alert",
  },
  {
    name: "cancellation beats generic failure",
    patch: { status: "failed", xreserveStatus: "cancelled" },
    headline: "Deposit cancelled in your wallet",
    live: false,
    complete: false,
    current: "source_finality",
    guidance: null,
  },
  {
    name: "replacement stops stale progress",
    patch: { xreserveStatus: "replaced" },
    headline: "Deposit replaced by another transaction",
    live: false,
    complete: false,
    current: "source_finality",
    guidance: null,
  },
  {
    name: "delivery beats stale failure",
    patch: { status: "failed", xreserveStatus: "delivered" },
    headline: "Delivered on Miden — claim in your wallet",
    live: false,
    complete: true,
    current: "consume",
    guidance: "wallet",
  },
  {
    name: "attestation beats forwarding",
    patch: { xreserveStatus: "attested", xreserveForwarding: true },
    headline: "Circle attested — waiting for Miden delivery",
    live: true,
    complete: false,
    current: "message_observed",
    guidance: null,
  },
  {
    name: "confirmation beats forwarding",
    patch: { xreserveStatus: "confirmed", xreserveForwarding: true },
    headline: "Waiting for Circle attestation",
    live: true,
    complete: false,
    current: "source_finality",
    guidance: null,
  },
  {
    name: "unsigned deposit asks for signature",
    patch: { status: "signature" },
    headline: "Confirm in your wallet",
    live: true,
    complete: false,
    current: "signature",
    guidance: null,
  },
])("$name", ({ patch, headline, live, complete, current, guidance }) => {
  const presentation = presentActivity({ ...deposit, ...patch });
  expect(presentation.headline).toBe(headline);
  const progress = presentation.progress;
  if (progress.kind !== "tracked") throw new Error("Expected tracked deposit");
  expect(progress.live).toBe(live);
  expect(progress.canRefresh).toBe(live);
  expect(progress.complete).toBe(complete);
  expect(
    progress.milestones
      .filter((step) => step.state === "current" || step.state === "failed")
      .map((step) => step.status),
  ).toEqual([current]);
  expect(presentation.guidance?.icon ?? null).toBe(guidance);
  expect(progress.deliveryWarningAt !== undefined).toBe(live);
});
