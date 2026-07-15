import { describe, expect, test } from "vitest";
import type { Activity } from "./bridge-state";
import { deriveMonitoredActivity } from "./bridge-monitor";

const baseReceive: Activity = {
  id: "act-receive-live",
  mode: "receive",
  provider: "agglayer",
  summary: "Receive 1 ETH on Miden",
  status: "source_finality",
  eta: "About 15 min",
  amount: "1",
  asset: "ETH",
  destination: "c98bb07c188cd2500e13f68a069cdc",
  bridgeDestinationAddress: "0x00000000c98bb07c188cd2500e13f68a069cdc00",
  txHash: "0xpreview...pending",
  sourceTxHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
  updatedAt: 0,
};

const baseSend: Activity = {
  id: "act-send-live",
  mode: "send",
  provider: "agglayer",
  summary: "Send 1 ETH to Sepolia",
  status: "message_observed",
  eta: "30-90 min",
  amount: "1",
  asset: "ETH",
  destination: "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
  txHash: "0xpreview...pending",
  sourceTxHash: "0x0490ad69e87c19c0c2c4b7951b87f0013c98bf5d90b7e14acbe821471ad5b91e",
  updatedAt: 0,
};

describe("deriveMonitoredActivity", () => {
  test("keeps Agglayer receive waiting for bridge observation after Sepolia source confirmation", () => {
    const next = deriveMonitoredActivity(baseReceive, {
      checkedAt: "Just now",
      sourceTx: {
        hash: baseReceive.sourceTxHash!,
        status: "confirmed",
        confirmations: 3,
        success: true,
      },
      agglayerDeposit: null,
    });

    expect(next.status).toBe("source_finality");
    expect(next.eta).toBe("Sepolia confirmed, waiting for Agglayer");
    // updatedAt is stamped with the current time (epoch ms), not the input 0.
    expect(typeof next.updatedAt).toBe("number");
    expect(next.updatedAt).toBeGreaterThan(0);
  });

  test("moves Agglayer receive to message observed when Gateway FM has a non-ready bridge row", () => {
    const next = deriveMonitoredActivity(baseReceive, {
      checkedAt: "Just now",
      sourceTx: {
        hash: baseReceive.sourceTxHash!,
        status: "confirmed",
        confirmations: 5,
        success: true,
      },
      agglayerDeposit: {
        ready_for_claim: false,
        tx_hash: baseReceive.sourceTxHash,
        deposit_cnt: 42,
      },
    });

    expect(next.status).toBe("message_observed");
    expect(next.depositCount).toBe("42");
    expect(next.readyForClaim).toBe(false);
  });

  test("marks Agglayer receive complete on delivery — the note is created on Miden and the user claims it in-wallet", () => {
    const next = deriveMonitoredActivity(baseReceive, {
      checkedAt: "Just now",
      sourceTx: {
        hash: baseReceive.sourceTxHash!,
        status: "confirmed",
        confirmations: 10,
        success: true,
      },
      agglayerDeposit: {
        ready_for_claim: true,
        tx_hash: baseReceive.sourceTxHash,
        deposit_cnt: 43,
      },
    });

    expect(next.status).toBe("complete");
    expect(next.readyForClaim).toBe(true);
    expect(next.eta).toBe("Delivered — claim in your Miden wallet");
  });

  test("captures the Miden note-creation tx (claim_tx_hash) as the destination claim, not the balance-reflecting consume", () => {
    const claimTx = "0x5f4201533ad8c79ec0786f7d455b6dfe06af897e6b063677cbb3217cd248fd38";
    const next = deriveMonitoredActivity(baseReceive, {
      checkedAt: "Just now",
      sourceTx: {
        hash: baseReceive.sourceTxHash!,
        status: "confirmed",
        confirmations: 10,
        success: true,
      },
      agglayerDeposit: {
        ready_for_claim: true,
        tx_hash: baseReceive.sourceTxHash,
        claim_tx_hash: claimTx,
        deposit_cnt: 1140994,
      },
    });

    // Agglayer destination claim happened (note created on Miden) — the app's
    // terminal success state. The Miden note is now the user's to claim in-wallet.
    expect(next.status).toBe("complete");
    expect(next.eta).toBe("Delivered — claim in your Miden wallet");
    // The claim_tx_hash is the Miden note-creation tx, surfaced for Midenscan.
    expect(next.midenTxId).toBe(claimTx);
    expect(next.destinationTxHash).toBe(claimTx);
    expect(next.claimTxHash).toBe(claimTx);
    // Source stays the Sepolia deposit, never the destination claim.
    expect(next.sourceTxHash).toBe(baseReceive.sourceTxHash);
  });

  test("advances to note-created via claim_tx_hash even if ready_for_claim lags", () => {
    const claimTx = "0xabc0000000000000000000000000000000000000000000000000000000000001";
    const next = deriveMonitoredActivity(baseReceive, {
      checkedAt: "Just now",
      sourceTx: {
        hash: baseReceive.sourceTxHash!,
        status: "confirmed",
        confirmations: 10,
        success: true,
      },
      agglayerDeposit: {
        ready_for_claim: false,
        tx_hash: baseReceive.sourceTxHash,
        claim_tx_hash: claimTx,
        deposit_cnt: 44,
      },
    });

    expect(next.status).toBe("complete");
    expect(next.midenTxId).toBe(claimTx);
  });

  test("moves Agglayer send to claim available when a filtered claim plan is ready", () => {
    const next = deriveMonitoredActivity(baseSend, {
      checkedAt: "Just now",
      claimPlan: {
        readyForClaim: true,
        depositCount: 7,
      },
    });

    expect(next.status).toBe("claim_available");
    expect(next.depositCount).toBe("7");
    expect(next.readyForClaim).toBe(true);
  });

  test("marks submitted Sepolia claim complete only after the claim transaction confirms successfully", () => {
    const next = deriveMonitoredActivity(
      {
        ...baseSend,
        status: "claim_submitted",
        claimTxHash: "0x2222222222222222222222222222222222222222222222222222222222222222",
      },
      {
        checkedAt: "Just now",
        destinationTx: {
          hash: "0x2222222222222222222222222222222222222222222222222222222222222222",
          status: "confirmed",
          confirmations: 2,
          success: true,
        },
      },
    );

    expect(next.status).toBe("complete");
    expect(next.eta).toBe("Settled on Sepolia");
  });

  test("marks failed chain transactions as failed instead of advancing locally", () => {
    const next = deriveMonitoredActivity(baseReceive, {
      checkedAt: "Just now",
      sourceTx: {
        hash: baseReceive.sourceTxHash!,
        status: "confirmed",
        confirmations: 1,
        success: false,
      },
    });

    expect(next.status).toBe("failed");
    expect(next.eta).toBe("Source transaction failed");
  });
});
