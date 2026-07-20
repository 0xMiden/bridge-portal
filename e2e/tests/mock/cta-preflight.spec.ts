import { test, expect } from "../../fixtures/bridge";
import type { Route, Mode } from "../../pages/bridge-page";

// Issue #55: the primary CTA is a deterministic progression (incomplete form →
// ready-to-review), and a valid transfer opens a preflight review before any
// wallet is invoked. In the mock tier both wallets are already connected and the
// destination is prefilled, so the observable CTA sequence is:
//   empty amount → disabled "Enter amount"  →  valid amount → "Review <dir>".

const combos: Array<{ route: Route; mode: Mode; label: RegExp }> = [
  { route: "Epoch", mode: "Receive", label: /Review receive/i },
  { route: "Epoch", mode: "Send", label: /Review send/i },
  { route: "AggLayer", mode: "Receive", label: /Review receive/i },
  { route: "AggLayer", mode: "Send", label: /Review send/i },
];

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
  await bridge.setRoute("AggLayer");
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

  await test.step("AggLayer receive with a valid amount", async () => {
    await bridge.setRoute("AggLayer");
    await bridge.setMode("Receive");
    await bridge.fillAmount("0.07");
    await bridge.fillDestination("0x00000000000000000000000000000000000000ab");
  });

  await test.step("open the preflight review", async () => {
    await bridge.openPreflight();
    await expect(bridge.preflight()).toContainText(/Review receive/i);
  });

  await test.step("cancel → form intact, no activity", async () => {
    await bridge.cancelPreflight();
    await expect(bridge.preflight()).toBeHidden();
    // Entered amount + destination survive the cancellation.
    await expect(
      page.locator(".swap-box input[aria-label='Amount']"),
    ).toHaveValue("0.07");
    await expect(page.locator(".destination-input input")).toHaveValue(
      "0x00000000000000000000000000000000000000ab",
    );
    expect((await bridge.readActivities()).length).toBe(0);
  });
});
