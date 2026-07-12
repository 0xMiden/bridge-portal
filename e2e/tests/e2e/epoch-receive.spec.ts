import { test, expect } from "../../fixtures/bridge";
import { readUsdcBalance, testEvmAddress, waitForSepoliaTxSuccess } from "../../driver/evm";

// Real Epoch receive (Sepolia USDC -> Miden): global-setup minted fresh USDC, so
// the deposit is affordable. We DETECT THE ACTUAL TRANSACTION — confirm the
// Compact deposit tx mined on Sepolia via a real receipt and check the intent
// nonce — rather than inferring success from a balance delta.
test.skip(
  !process.env.E2E_EVM_PRIVATE_KEY,
  "requires a funded Sepolia key (E2E_EVM_PRIVATE_KEY)",
);

test("epoch receive deposits USDC and records the intent", async ({
  bridge,
  steps,
}) => {
  await steps.step("wallets ready", () => bridge.waitForReady());

  // Precondition (not the assertion): the deposit needs USDC to spend.
  await steps.step("USDC available (minted in global-setup)", async () => {
    const bal = await readUsdcBalance(testEvmAddress());
    expect(bal).toBeGreaterThan(1_000_000_000_000_000_000n); // > 1 USDC (18-dp)
  });

  await steps.step("configure Epoch receive (1 USDC)", async () => {
    await bridge.setRoute("Epoch");
    await bridge.setMode("Receive");
    await bridge.fillAmount("1");
  });

  await steps.step("submit -> real deposit tx + intent recorded", async () => {
    await bridge.submit();
    await bridge.openActivity();
    const activity = ((await bridge.readActivities())[0] ?? {}) as Record<
      string,
      unknown
    >;
    const sourceTxHash = String(activity.sourceTxHash ?? "");
    expect(sourceTxHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    // CONFIRM the Compact deposit actually mined & succeeded on Sepolia.
    expect(await waitForSepoliaTxSuccess(sourceTxHash as `0x${string}`)).toBe(true);
    // The intent the solver mints against.
    expect(activity.epochIntentNonce).toBeTruthy();
  });
});
