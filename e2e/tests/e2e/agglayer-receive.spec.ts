import { test, expect } from "../../fixtures/bridge";

// Real Sepolia -> Miden AggLayer receive: injected EVM wallet signs a real
// bridge deposit; assert an activity row lands with a real source tx hash and
// the monitor advances past signature. Full ~30-90 min settlement is a separate
// @slow spec — this proves the app builds + submits + tracks a real deposit.
test.skip(
  !process.env.E2E_EVM_PRIVATE_KEY,
  "requires a funded Sepolia key (E2E_EVM_PRIVATE_KEY)",
);

test("agglayer receive broadcasts a real Sepolia deposit and tracks it", async ({
  bridge,
  steps,
}) => {
  await steps.step("wallets ready", () => bridge.waitForReady());

  await steps.step("configure AggLayer receive (small ETH)", async () => {
    await bridge.setRoute("AggLayer");
    await bridge.setMode("Receive");
    await bridge.fillAmount("0.0001");
  });

  await steps.step("submit -> real deposit broadcasts", async () => {
    await bridge.submit();
    await bridge.openActivity();
  });

  await steps.step("activity has a real source tx + advances", async () => {
    const activities = await bridge.readActivities();
    expect(activities.length).toBeGreaterThan(0);
    const activity = activities[0] as Record<string, unknown>;
    expect(String(activity.sourceTxHash ?? "")).toMatch(/^0x[0-9a-fA-F]{64}$/);
    // Monitor should be past the initial "signature" state once broadcast.
    expect(activity.status).not.toBe("signature");
    // Status strip on the detail page reflects a live status.
    const badge = await bridge.statusBadgeText();
    expect(badge.length).toBeGreaterThan(0);
  });
});
