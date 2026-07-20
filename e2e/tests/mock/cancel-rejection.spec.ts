import { test, expect } from "../../fixtures/bridge";

// Cancelling the wallet prompt (injected signer throws 4001) shows the friendly
// inline message and leaves the app intact — the regression behind the
// blank-page-on-cancel fix.
test("cancelled wallet prompt: friendly message, no blank page", async ({
  bridge,
  page,
}) => {
  await test.step("wallets ready", () => bridge.waitForReady());

  await test.step("arm reject mode", () =>
    page.evaluate(() => window.localStorage.setItem("e2e-signer-mode", "reject")),
  );

  await test.step("AggLayer receive, small amount", async () => {
    await bridge.setRoute("AggLayer");
    await bridge.setMode("Receive");
    await bridge.fillAmount("0.01");
  });

  await test.step("submit rejects → friendly message, card intact", async () => {
    await bridge.submit();
    await expect(page.locator(".form-error")).toContainText(/cancelled/i);
    await expect(page.locator(".swap-card")).toBeVisible();
    // No activity row was created for a rejected submit.
    const activities = await bridge.readActivities();
    expect(activities.length).toBe(0);
  });
});
