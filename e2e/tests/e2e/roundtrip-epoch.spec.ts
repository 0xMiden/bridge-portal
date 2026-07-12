import { test, expect } from "../../fixtures/bridge";

// @slow self-funding round-trip: bridge USDC Sepolia -> Miden (receive), wait
// for it to settle into the seed-account, then bridge a smaller amount back
// (send). This is how the send path gets validated without a pre-funded Miden
// account — the receive funds it, and the signer auto-consumes the bridged note
// before sending. Epoch settles fast (~1-3 min); AggLayer would need ~15.
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

  await steps.step("wait for the receive to settle on Miden", async () => {
    // Poll the receive activity until it's settled (funds consumable), rather
    // than a fixed sleep — real Epoch settlement ran past 4 min in practice.
    const deadline = Date.now() + SETTLE_MS;
    let status = "";
    while (Date.now() < deadline) {
      const receive = (await bridge.readActivities()).find(
        (a) => (a as Record<string, unknown>).mode === "receive",
      ) as Record<string, unknown> | undefined;
      status = String(receive?.status ?? "");
      if (["claim_available", "complete"].includes(status)) break;
      await page.waitForTimeout(15_000);
    }
    expect(["claim_available", "complete"]).toContain(status);
  });

  await steps.step("send 0.5 USDC back (auto-consumes the bridged note)", async () => {
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
    expect(activity.status).not.toBe("signature");
  });
});
