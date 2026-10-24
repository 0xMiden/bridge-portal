import type { IntentTransactionStatus } from "@epoch-protocol/epoch-intents-sdk";
import { describe, expect, test, vi } from "vitest";
import { defaultBridgeRoute, findBridgeRoute } from "../../core/routes";
import { observeActivity } from "../../tracking";
import { getEpochReadOnlySdk } from "./sdk";

vi.mock("./sdk", () => ({ getEpochReadOnlySdk: vi.fn() }));

import { epochActivityState, epochDestinationTx } from "./epoch-status";

// Destination chain ids used across the suite. Receive settles on Miden's
// virtual chain id; Send settles on Sepolia. These mirror config.ts /
// bridgeable-token.ts but are inlined so the mapping's behaviour is asserted
// independently of those constants.
const MIDEN_DEST = 999999999; // Receive (EVM→Miden) destination
const SEPOLIA_DEST = 11155111; // Send (Miden→EVM) destination
const MIDEN_SOURCE_ROW = 1234; // arbitrary non-destination (source) leg chain id

const TX = "0xdeadbeef000000000000000000000000000000000000000000000000cafebabe";

function row(
  status: string,
  chainId: number,
  transactionHash = "",
): IntentTransactionStatus {
  return { status, chainId, transactionHash };
}

test.each([
  ...(["send", "receive"] as const).map(mode => ({ route: defaultBridgeRoute("epoch", mode)!, destination: mode === "send" ? SEPOLIA_DEST : MIDEN_DEST })),
  ...[["ethereum", 1], ["base", 8453], ["arbitrum", 42161], ["polygon", 137]].flatMap(([network, chainId]) =>
    (["send", "receive"] as const).map(mode => ({ route: findBridgeRoute(`mainnet:epoch:${network}:${mode}`)!, destination: mode === "send" ? Number(chainId) : MIDEN_DEST }))),
])("$route.id tracking attributes a failed payout to the destination leg", async ({ route, destination }) => {
  const { mode } = route;
  const sdk = { getIntentStatus: vi.fn().mockResolvedValue([row("reverted", destination)]) };
  vi.mocked(getEpochReadOnlySdk).mockResolvedValue(sdk as unknown as Awaited<ReturnType<typeof getEpochReadOnlySdk>>);
  const observation = await observeActivity({
    routeSnapshot: route, environment: route.recovery.environment,
    id: "failed-payout", provider: "epoch", mode, asset: "USDC", amount: "1", status: "message_observed",
    epochSponsor: "0x1111111111111111111111111111111111111111", epochIntentNonce: "42",
    updatedAt: 1, summary: "", eta: "", txHash: "",
  }, new AbortController().signal);
  expect(observation?.patch).toMatchObject({ status: "failed", failureLeg: "destination" });
});

describe("epochActivityState", () => {
  test("undefined statuses map to source_finality (nothing observed yet)", () => {
    expect(epochActivityState(undefined, SEPOLIA_DEST)).toMatchObject({ status: "source_finality" });
  });

  test("empty statuses map to source_finality", () => {
    expect(epochActivityState([], SEPOLIA_DEST)).toMatchObject({ status: "source_finality" });
  });

  test("any failed leg maps to failed", () => {
    const statuses = [row("pending", SEPOLIA_DEST), row("failed", SEPOLIA_DEST)];
    expect(epochActivityState(statuses, SEPOLIA_DEST)).toMatchObject({ status: "failed" });
  });

  test("a reverted leg also maps to failed", () => {
    expect(epochActivityState([row("reverted", SEPOLIA_DEST)], SEPOLIA_DEST)).toMatchObject({ status: "failed" });
  });

  test("failure detection is case-insensitive", () => {
    expect(epochActivityState([row("FAILED", SEPOLIA_DEST)], SEPOLIA_DEST)).toMatchObject({ status: "failed" });
    expect(epochActivityState([row("Reverted", SEPOLIA_DEST)], SEPOLIA_DEST)).toMatchObject({ status: "failed" });
  });

  test("failure wins even when a destination leg has already settled", () => {
    const statuses = [
      row("success", SEPOLIA_DEST, TX),
      row("failed", MIDEN_SOURCE_ROW),
    ];
    expect(epochActivityState(statuses, SEPOLIA_DEST)).toMatchObject({ status: "failed" });
  });

  test("destination leg terminal-OK with a tx hash maps to complete", () => {
    expect(
      epochActivityState([row("success", SEPOLIA_DEST, TX)], SEPOLIA_DEST),
    ).toMatchObject({ status: "complete" });
  });

  test("'completed' is also treated as terminal-OK", () => {
    expect(
      epochActivityState([row("completed", SEPOLIA_DEST, TX)], SEPOLIA_DEST),
    ).toMatchObject({ status: "complete" });
  });

  test("terminal-OK detection is case-insensitive", () => {
    expect(
      epochActivityState([row("SUCCESS", SEPOLIA_DEST, TX)], SEPOLIA_DEST),
    ).toMatchObject({ status: "complete" });
  });

  test("destination terminal-OK without a tx hash is NOT complete", () => {
    // A terminal row that lacks a real tx hash can't be deep-linked, so the
    // activity stays in flight rather than falsely reporting settlement.
    expect(
      epochActivityState([row("success", SEPOLIA_DEST, "")], SEPOLIA_DEST),
    ).toMatchObject({ status: "message_observed" });
  });

  test("a still-pending destination row blocks completion even if a sibling settled", () => {
    const statuses = [
      row("success", SEPOLIA_DEST, TX),
      row("pending", SEPOLIA_DEST),
    ];
    expect(epochActivityState(statuses, SEPOLIA_DEST)).toMatchObject({ status: "message_observed" });
  });

  test("destination-aware: a settled SOURCE leg does not complete the activity", () => {
    // The regression this guards: a Send's Miden source leg settles first. A
    // chain-agnostic check would flip to complete while the Sepolia payout is
    // still pending. Only a terminal DESTINATION row may complete it.
    const statuses = [row("success", MIDEN_SOURCE_ROW, TX)];
    expect(epochActivityState(statuses, SEPOLIA_DEST)).toMatchObject({ status: "message_observed" });
  });

  test("observed but non-terminal rows map to message_observed", () => {
    const statuses = [row("pending", MIDEN_SOURCE_ROW), row("pending", SEPOLIA_DEST)];
    expect(epochActivityState(statuses, SEPOLIA_DEST)).toMatchObject({ status: "message_observed" });
  });

  test("Receive direction settles on the Miden destination chain id", () => {
    expect(
      epochActivityState([row("success", MIDEN_DEST, TX)], MIDEN_DEST),
    ).toMatchObject({ status: "complete" });
    // The same rows keyed to Sepolia (wrong destination) do not complete.
    expect(
      epochActivityState([row("success", MIDEN_DEST, TX)], SEPOLIA_DEST),
    ).toMatchObject({ status: "message_observed" });
  });

  test("string chainId values are coerced before comparison", () => {
    // The SDK types chainId as number, but allocator payloads have been seen as
    // strings; the mapping coerces with Number() so a stringly-typed dest row
    // still completes.
    const statuses = [
      { status: "success", chainId: String(SEPOLIA_DEST), transactionHash: TX },
    ] as unknown as IntentTransactionStatus[];
    expect(epochActivityState(statuses, SEPOLIA_DEST)).toMatchObject({ status: "complete" });
  });
});

describe("epochDestinationTx", () => {
  test("returns the settled destination tx hash", () => {
    expect(
      epochDestinationTx([row("success", SEPOLIA_DEST, TX)], SEPOLIA_DEST),
    ).toBe(TX);
  });

  test("returns undefined for undefined statuses", () => {
    expect(epochDestinationTx(undefined, SEPOLIA_DEST)).toBeUndefined();
  });

  test("returns undefined when no destination leg has settled", () => {
    expect(
      epochDestinationTx([row("pending", SEPOLIA_DEST)], SEPOLIA_DEST),
    ).toBeUndefined();
  });

  test("ignores a terminal-OK row on a non-destination chain", () => {
    // Source leg settled with a hash, but it is not the destination tx.
    expect(
      epochDestinationTx([row("success", MIDEN_SOURCE_ROW, TX)], SEPOLIA_DEST),
    ).toBeUndefined();
  });

  test("ignores a destination row that is terminal-OK but has no tx hash", () => {
    expect(
      epochDestinationTx([row("success", SEPOLIA_DEST, "")], SEPOLIA_DEST),
    ).toBeUndefined();
  });

  test("picks the destination row over an earlier source-chain settlement", () => {
    const destTx =
      "0xabc1230000000000000000000000000000000000000000000000000000000001";
    const statuses = [
      row("success", MIDEN_SOURCE_ROW, TX),
      row("success", SEPOLIA_DEST, destTx),
    ];
    expect(epochDestinationTx(statuses, SEPOLIA_DEST)).toBe(destTx);
  });
});
