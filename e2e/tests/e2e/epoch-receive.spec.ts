import { test, expect } from "../../fixtures/bridge";
import { readUsdcBalance } from "../../driver/evm";
import { testEvmAddress } from "../../driver/evm";

// Real Epoch receive (Sepolia USDC -> Miden): global-setup minted fresh USDC, so
// the deposit is affordable. Injected EVM wallet signs the Compact
// approve+deposit; assert an activity lands with the intent nonce + a real
// source tx, and the monitor reaches message_observed.
test.skip(
  !process.env.E2E_EVM_PRIVATE_KEY,
  "requires a funded Sepolia key (E2E_EVM_PRIVATE_KEY)",
);

test("epoch receive deposits USDC and records the intent", async ({
  bridge,
  steps,
}) => {
  await steps.step("wallets ready", () => bridge.waitForReady());

  await steps.step("USDC balance is sufficient (minted in global-setup)", async () => {
    const bal = await readUsdcBalance(testEvmAddress());
    expect(bal).toBeGreaterThan(1_000_000_000_000_000_000n); // > 1 USDC (18-dp)
  });

  await steps.step("configure Epoch receive (1 USDC)", async () => {
    await bridge.setRoute("Epoch");
    await bridge.setMode("Receive");
    await bridge.fillAmount("1");
  });

  await steps.step("submit -> approve+deposit signs, intent recorded", async () => {
    await bridge.submit();
    await bridge.openActivity();
    const activities = await bridge.readActivities();
    const activity = (activities[0] ?? {}) as Record<string, unknown>;
    expect(String(activity.sourceTxHash ?? "")).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(activity.epochIntentNonce).toBeTruthy();
    expect(activity.status).not.toBe("signature");
  });
});
