import { test, expect } from "../../fixtures/bridge";
import type { Route, Mode } from "../../pages/bridge-page";

// Issue #55: the primary CTA is a deterministic progression (incomplete form →
// ready-to-review), and a valid transfer opens a preflight review before any
// wallet is invoked. In the mock tier both wallets are already connected and the
// destination comes from the receiving wallet, so the observable CTA sequence is:
//   empty amount → disabled "Enter amount"  →  valid amount → "Review <dir>".

const combos: Array<{ route: Route; mode: Mode; label: RegExp }> = [
  { route: "USDCx", mode: "Receive", label: /Review transfer/i },
];

test("Miden balances load on connection, stay visible across origins, and reload automatically", async ({ bridge, page }) => {
  const midenBalance = page.locator(".swap-box").last();
  await expect(midenBalance).toContainText("Available 0 USDCx");
  await bridge.setChain("Sepolia");
  await expect(midenBalance).toContainText("Available 0 USDCx");
  await page.getByRole("button", { name: "Refresh Miden balance" }).click();
  await expect(midenBalance).toContainText("Available 0 USDCx");
  await page.reload();
  await bridge.waitForReady();
  await expect(midenBalance).toContainText("Available 0 USDCx");
});

for (const { route, mode, label } of combos) {
  test(`${route} ${mode}: CTA gates on a valid amount, then offers review`, async ({
    bridge,
  }) => {
    await test.step("wallets ready", () => bridge.waitForReady());

    await test.step("select route + direction", async () => {
      await bridge.setRoute(route);
      await bridge.setMode(mode);
    });

    await test.step("empty amount → disabled 'Enter amount'", async () => {
      const cta = bridge.primaryButton();
      await expect(cta).toContainText(/Enter amount/i);
      await expect(cta).toBeDisabled();
    });

    await test.step("valid amount → 'Review' CTA appears (enabled)", async () => {
      await bridge.fillAmount("0.05");
      const cta = bridge.primaryButton();
      await expect(cta).toContainText(label);
      await expect(cta).toBeEnabled();
    });
  });
}

test("invalid amounts never open the preflight or call a wallet", async ({
  bridge,
}) => {
  await test.step("wallets ready", () => bridge.waitForReady());
  await bridge.setRoute("USDCx");
  await bridge.setMode("Receive");

  for (const bad of ["0", "-1", "abc"]) {
    await test.step(`amount "${bad}" keeps the CTA disabled`, async () => {
      await bridge.fillAmount(bad);
      const cta = bridge.primaryButton();
      await expect(cta).toContainText(/Enter amount/i);
      await expect(cta).toBeDisabled();
      // No review surface, and nothing was submitted.
      await expect(bridge.preflight()).toBeHidden();
      expect((await bridge.readActivities()).length).toBe(0);
    });
  }
});

test("cancelling the preflight preserves entered data and calls no wallet", async ({
  bridge,
  page,
}) => {
  await test.step("wallets ready", () => bridge.waitForReady());

  await test.step("USDCx receive with a valid amount", async () => {
    await bridge.setRoute("USDCx");
    await bridge.setMode("Receive");
    await bridge.fillAmount("0.07");
  });

  await test.step("open the preflight review", async () => {
    await bridge.openPreflight();
    await expect(bridge.preflight()).toContainText(/Review receive/i);
  });

  await test.step("cancel → form intact, no activity", async () => {
    await bridge.cancelPreflight();
    await expect(bridge.preflight()).toBeHidden();
    // The amount survives cancellation; the destination remains the wallet's account.
    await expect(
      page.locator(".swap-box input[aria-label='Amount']"),
    ).toHaveValue("0.07");
    expect((await bridge.readActivities()).length).toBe(0);
    await bridge.openPreflight();
    await expect(page.locator("#preflight-destination-value")).toHaveAttribute(
      "title", await page.evaluate(() => window.__E2E__!.midenAddress!),
    );
  });
});
