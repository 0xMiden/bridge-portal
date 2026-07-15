import { test, expect } from "../../fixtures/bridge";

// @slow self-funding round-trip: bridge USDC Sepolia -> Miden (receive), wait
// for it to settle into the seed-account, then bridge a smaller amount back
// (send). The receive funds it and the signer auto-consumes the bridged note
// before sending.
//
// KNOWN LIMITATION (observed on testnet): after ~20 min the receive's Miden-side
// note never showed as consumable to the injected signer's fresh WebClient
// (getConsumableNotes stayed 0). Likely either Epoch's Miden mint is slow, or
// the bridged note is PRIVATE — a fresh client can't discover a private note it
// didn't receive itself, unlike the real MidenFi wallet. Validating the send
// path therefore needs a Miden account with already-spendable balance (or
// private-note import). Kept as the intended shape for when that's available.
test.skip(
  !process.env.E2E_EVM_PRIVATE_KEY || !process.env.E2E_MIDEN_SEED,
  "requires funded Sepolia key + Miden seed",
);

// Max time to wait for the receive to settle into spendable Miden balance.
const SETTLE_MS = Number(process.env.E2E_SETTLE_MS ?? 900_000); // 15 min

test("epoch round-trip: receive funds the account, then send back", async ({
  bridge,
  steps,
  page,
}) => {
  test.setTimeout(SETTLE_MS + 8 * 60_000);

  await steps.step("wallets ready", () => bridge.waitForReady());

  await steps.step("receive 1 USDC into the Miden account", async () => {
    await bridge.setRoute("Epoch");
    await bridge.setMode("Receive");
    await bridge.fillAmount("1");
    await bridge.submit();
    await bridge.waitForActivityRow();
    const activity = ((await bridge.readActivities())[0] ?? {}) as Record<
      string,
      unknown
    >;
    expect(String(activity.sourceTxHash ?? "")).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });

  await steps.step("DETECT the bridged note arriving on Miden", async () => {
    // Gate on the real on-chain artifact — a consumable note on the account —
    // NOT a balance delta or the app's (stalls-at-message_observed) status.
    const deadline = Date.now() + SETTLE_MS;
    let count = 0;
    while (Date.now() < deadline) {
      count = await page.evaluate(
        () => window.__E2E__?.midenConsumableCount?.() ?? Promise.resolve(0),
      );
      if (count > 0) break;
      await page.waitForTimeout(15_000);
    }
    expect(count, "no bridged note arrived on the Miden account").toBeGreaterThan(0);
  });

  await steps.step("send 0.5 USDC back -> real Miden tx submitted", async () => {
    await bridge.setRoute("Epoch");
    await bridge.setMode("Send");
    await bridge.fillAmount("0.5");
    await bridge.submit();
    await bridge.openActivity();
    const activity = ((await bridge.readActivities())[0] ?? {}) as Record<
      string,
      unknown
    >;
    expect(activity.provider).toBe("epoch");
    expect(activity.mode).toBe("send");
    // The Miden signer's submitNewTransaction returns only after proving +
    // submitting to the node — a real tx id, not an inferred amount change.
    expect(String(activity.midenTxId ?? activity.sourceTxHash ?? "")).not.toBe("");
    expect(activity.status).not.toBe("signature");
  });
});
