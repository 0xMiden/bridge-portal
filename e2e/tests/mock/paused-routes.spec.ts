import { test, expect } from "../../fixtures/bridge";

// New transfers through paused providers must fall back even when a launch URL
// or an old stored preference requests their receive/send route. Existing
// transfers remain covered by activity-tracking.spec.ts.
for (const provider of ["epoch"] as const) {
  for (const mode of ["receive", "send"] as const) {
    test(`${provider} ${mode}: saved and URL selections fall back to USDCx`, async ({ bridge, page }) => {
      await page.evaluate(({ provider, mode }) => {
        localStorage.setItem("miden.bridge.ui.route", provider);
        localStorage.setItem("miden.bridge.ui.mode", mode);
        localStorage.setItem("miden.bridge.ui.route.id", `${provider}-${provider === "epoch" ? "usdc" : "eth"}-to-${mode === "receive" ? "miden" : "sepolia"}`);
      }, { provider, mode });
      await page.reload();
      await bridge.waitForReady();
      await expect(bridge.routeTrigger()).toContainText("USDCx");
      await page.goto(`/?provider=${provider}&mode=${mode}`);
      await bridge.waitForReady();
      await expect(bridge.routeTrigger()).toContainText("USDCx");
      await expect(page.locator(".mode-switch button[aria-pressed='true']")).toHaveText("Receive");
      await expect(page.locator(".mode-switch").getByRole("button", { name: "Send", exact: true })).toBeDisabled();
      expect(await bridge.readActivities()).toEqual([]);
    });
  }
}
