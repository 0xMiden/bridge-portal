import type { IntentTransactionStatus } from "@epoch-protocol/epoch-intents-sdk";
import { describe, expect, test } from "vitest";

import { epochActivityStatus, epochDestinationTx } from "./epoch-status";

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

describe("epochActivityStatus", () => {
  test("undefined statuses map to source_finality (nothing observed yet)", () => {
    expect(epochActivityStatus(undefined, SEPOLIA_DEST)).toBe("source_finality");
  });

  test("empty statuses map to source_finality", () => {
    expect(epochActivityStatus([], SEPOLIA_DEST)).toBe("source_finality");
  });

  test("any failed leg maps to failed", () => {
    const statuses = [row("pending", SEPOLIA_DEST), row("failed", SEPOLIA_DEST)];
    expect(epochActivityStatus(statuses, SEPOLIA_DEST)).toBe("failed");
  });

  test("a reverted leg also maps to failed", () => {
    expect(epochActivityStatus([row("reverted", SEPOLIA_DEST)], SEPOLIA_DEST)).toBe(
      "failed",
    );
  });

  test("failure detection is case-insensitive", () => {
    expect(epochActivityStatus([row("FAILED", SEPOLIA_DEST)], SEPOLIA_DEST)).toBe(
      "failed",
    );
    expect(epochActivityStatus([row("Reverted", SEPOLIA_DEST)], SEPOLIA_DEST)).toBe(
      "failed",
    );
  });

  test("failure wins even when a destination leg has already settled", () => {
    const statuses = [
      row("success", SEPOLIA_DEST, TX),
      row("failed", MIDEN_SOURCE_ROW),
    ];
    expect(epochActivityStatus(statuses, SEPOLIA_DEST)).toBe("failed");
  });

  test("destination leg terminal-OK with a tx hash maps to complete", () => {
    expect(
      epochActivityStatus([row("success", SEPOLIA_DEST, TX)], SEPOLIA_DEST),
    ).toBe("complete");
  });

  test("'completed' is also treated as terminal-OK", () => {
    expect(
      epochActivityStatus([row("completed", SEPOLIA_DEST, TX)], SEPOLIA_DEST),
    ).toBe("complete");
  });

  test("terminal-OK detection is case-insensitive", () => {
    expect(
      epochActivityStatus([row("SUCCESS", SEPOLIA_DEST, TX)], SEPOLIA_DEST),
    ).toBe("complete");
  });

  test("destination terminal-OK without a tx hash is NOT complete", () => {
    // A terminal row that lacks a real tx hash can't be deep-linked, so the
    // activity stays in flight rather than falsely reporting settlement.
    expect(
      epochActivityStatus([row("success", SEPOLIA_DEST, "")], SEPOLIA_DEST),
    ).toBe("message_observed");
  });

  test("a still-pending destination row blocks completion even if a sibling settled", () => {
    const statuses = [
      row("success", SEPOLIA_DEST, TX),
      row("pending", SEPOLIA_DEST),
    ];
    expect(epochActivityStatus(statuses, SEPOLIA_DEST)).toBe("message_observed");
  });

  test("destination-aware: a settled SOURCE leg does not complete the activity", () => {
    // The regression this guards: a Send's Miden source leg settles first. A
    // chain-agnostic check would flip to complete while the Sepolia payout is
    // still pending. Only a terminal DESTINATION row may complete it.
    const statuses = [row("success", MIDEN_SOURCE_ROW, TX)];
    expect(epochActivityStatus(statuses, SEPOLIA_DEST)).toBe("message_observed");
  });

  test("observed but non-terminal rows map to message_observed", () => {
    const statuses = [row("pending", MIDEN_SOURCE_ROW), row("pending", SEPOLIA_DEST)];
    expect(epochActivityStatus(statuses, SEPOLIA_DEST)).toBe("message_observed");
  });

  test("Receive direction settles on the Miden destination chain id", () => {
    expect(
      epochActivityStatus([row("success", MIDEN_DEST, TX)], MIDEN_DEST),
    ).toBe("complete");
    // The same rows keyed to Sepolia (wrong destination) do not complete.
    expect(
      epochActivityStatus([row("success", MIDEN_DEST, TX)], SEPOLIA_DEST),
    ).toBe("message_observed");
  });

  test("string chainId values are coerced before comparison", () => {
    // The SDK types chainId as number, but allocator payloads have been seen as
    // strings; the mapping coerces with Number() so a stringly-typed dest row
    // still completes.
    const statuses = [
      { status: "success", chainId: String(SEPOLIA_DEST), transactionHash: TX },
    ] as unknown as IntentTransactionStatus[];
    expect(epochActivityStatus(statuses, SEPOLIA_DEST)).toBe("complete");
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
