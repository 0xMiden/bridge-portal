import { EVM_ADDRESS, MIDEN_ADDRESS, walletRequests } from "../../fixtures/wallets";
import { test, expect } from "../../fixtures/bridge";

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

test("invalid amounts never open the preflight or call a wallet", async ({
  bridge, page,
}) => {
  await test.step("wallets ready", () => bridge.waitForReady());
  await bridge.setRoute("USDCx");
  await bridge.setMode("Receive");

  for (const bad of ["", "0", "-1", "abc"]) {
    await test.step(`amount "${bad}" keeps the CTA disabled`, async () => {
      await bridge.fillAmount(bad);
      const cta = bridge.primaryButton();
      await expect(cta).toContainText(/Enter amount/i);
      await expect(cta).toBeDisabled();
      // No review surface, and nothing was submitted.
      await expect(bridge.preflight()).toBeHidden();
      expect((await bridge.readActivities()).length).toBe(0);
      expect(await walletRequests(page)).toEqual([]);
    });
  }
});

test("cancelling the preflight preserves entered data and calls no wallet", async ({
  bridge,
  page,
}, testInfo) => {
  await test.step("wallets ready", () => bridge.waitForReady());

  await test.step("ETH receive with a valid amount", async () => {
    await bridge.setRoute("AggLayer");
    await bridge.setMode("Receive");
    await bridge.fillAmount("0.001");
  });

  await test.step("open the preflight review", async () => {
    await bridge.openPreflight();
    await expect(bridge.preflight()).toContainText(/Review transfer/i);
    const panel = page.locator(".preflight-panel");
    await expect(panel.locator(".preflight-quantity")).toHaveText("0.001 ETH");
    await expect(panel.locator(".fiat-amount")).toHaveText("$3.20");
    await expect(panel.locator(".preflight-stop .network-logo")).toHaveCount(2);
    const accounts = { from: EVM_ADDRESS, to: MIDEN_ADDRESS };
    for (const [side, account] of [["source", accounts.from], ["destination", accounts.to]]) {
      const address = panel.locator(`#preflight-${side}-value`);
      await expect(address).toHaveAttribute("title", account);
      await address.click();
      await expect(address).toHaveText(account);
      await address.click();
    }
    await expect(panel.getByText("Network fee", { exact: true })).toBeVisible();
    await expect(panel.getByText("Provider fee", { exact: true })).toBeVisible();
    await expect(panel.getByText("Minimum received", { exact: true })).toHaveCount(0);
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await expect(panel).toBeVisible();
      await expect(async () => {
        const box = await panel.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.width).toBeLessThanOrEqual(viewport.width > 640 ? 440 : viewport.width);
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.y).toBeGreaterThanOrEqual(0);
        expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
        expect(Math.abs(box!.x + box!.width / 2 - viewport.width / 2)).toBeLessThan(2);
      }).toPass();
      await expect(page.getByRole("button", { name: "Confirm in wallet", exact: true })).toBeInViewport();
      await page.screenshot({ path: testInfo.outputPath(`review-${viewport.width}.png`), animations: "disabled" });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  await test.step("cancel → form intact, no activity", async () => {
    await bridge.cancelPreflight();
    await expect(bridge.preflight()).toBeHidden();
    // The amount survives cancellation; the destination remains the wallet's account.
    await expect(
      page.locator(".swap-box input[aria-label='Amount']"),
    ).toHaveValue("0.001");
    expect((await bridge.readActivities()).length).toBe(0);
    expect(await walletRequests(page)).toEqual([]);
    await bridge.openPreflight();
    await expect(page.locator("#preflight-destination-value")).toHaveAttribute(
      "title", MIDEN_ADDRESS,
    );
  });
});
