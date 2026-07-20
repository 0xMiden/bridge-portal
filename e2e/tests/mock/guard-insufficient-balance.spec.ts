import { test, expect } from "../../fixtures/bridge";

// The insufficient-balance guard blocks the CTA before any wallet prompt when
// the amount exceeds the (stubbed = 1 USDC) Sepolia balance.
test("receive above balance disables the CTA", async ({ bridge }) => {
  await test.step("wallets ready", () => bridge.waitForReady());

  await test.step("Epoch receive, amount over balance", async () => {
    await bridge.setRoute("Epoch");
    await bridge.setMode("Receive");
    await bridge.fillAmount("100"); // stubbed balance is 1 USDC
  });

  await test.step("CTA reads 'Not enough' and is disabled", async () => {
    const cta = bridge.primaryButton();
    await expect(cta).toContainText(/Not enough/i);
    await expect(cta).toBeDisabled();
  });
});
