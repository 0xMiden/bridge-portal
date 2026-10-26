import { expect, type Page } from "@playwright/test";

export type Route = "AggLayer" | "Epoch" | "USDCx";
export type Mode = "Receive" | "Send";

export class BridgePage {
  constructor(private readonly page: Page) {}

  /** Connect through the same UI and extension discovery as a user's wallet. */
  async waitForReady(timeout = 30_000): Promise<void> {
    const evm = this.page.locator('[data-wallet="evm"] .wallet-pill');
    await expect(evm).toBeVisible({ timeout });
    if ((await evm.getAttribute("data-connected")) !== "true") {
      await evm.click();
      await this.page.getByText("Browser test wallet", { exact: true }).click();
    }
    await expect(evm).toHaveAttribute("data-connected", "true", { timeout });
    const miden = this.page.locator('[data-wallet="miden"] .wallet-pill');
    await expect(miden).toBeVisible({ timeout });
    if ((await miden.getAttribute("data-connected")) !== "true") {
      // Restore can complete between rendering the pill and opening its menu.
      await miden.click();
      const connect = this.page.getByRole("menuitem", { name: "Connect wallet", exact: true });
      const disconnect = this.page.getByRole("menuitem", { name: "Disconnect", exact: true });
      await expect(connect.or(disconnect)).toBeVisible({ timeout });
      if (await connect.isVisible()) await connect.click();
      else await this.page.keyboard.press("Escape");
    }
    await expect(miden).toHaveAttribute("data-connected", "true", { timeout });
  }

  async setRoute(route: Route): Promise<void> {
    // Assets/networks define the route; the provider picker only contains
    // compatible providers and must never silently switch assets.
    if (!new RegExp(route, "i").test((await this.selectedProvider().textContent()) ?? "")) {
      await this.setChain("Sepolia");
      await this.page.locator(".token-select-trigger").first().click();
      const token = route === "AggLayer" ? "ETH Ether" : route === "USDCx" ? "USDC Circle USDC" : "USDC Epoch test USDC";
      await this.page.getByRole("listbox", { name: "Token", exact: true })
        .getByRole("option", { name: token, exact: true }).click();
    }
    // Case-insensitive: the semantic route name ("AggLayer") differs from the
    // UI label casing ("Agglayer", lowercase L).
    await expect(this.selectedProvider()).toContainText(
      new RegExp(route, "i"),
    );
  }

  async setChain(label: string): Promise<void> {
    await this.page.getByRole("combobox", { name: /Origin chain|Destination chain/ }).click();
    await this.page.getByRole("listbox", { name: /Origin chain|Destination chain/ })
      .getByRole("option", { name: label, exact: true }).click();
  }

  async setMode(mode: Mode): Promise<void> {
    await this.page
      .locator(".mode-switch button", { hasText: mode === "Receive" ? "Deposit" : "Withdraw" })
      .click();
  }

  async fillAmount(amount: string): Promise<void> {
    const input = this.page.locator(".swap-box input[aria-label='Amount']");
    await input.fill(amount);
  }

  async waitForActivityPage(timeout = 60_000): Promise<void> {
    await this.page.waitForURL(/\/activity\//, { timeout });
    await this.page.locator(".detail-simple, .rcpt-paper, .status-badge").first()
      .waitFor({ state: "visible", timeout });
  }

  primaryButton() {
    return this.actionDock().locator(".primary-button");
  }

  routeTrigger() {
    return this.page.locator(".route-trigger");
  }

  selectedProvider() {
    return this.page.locator(".selected-provider");
  }

  providerOptions() {
    return this.page.getByRole("group", { name: "Compatible providers" });
  }

  actionDock() {
    return this.page.locator(".primary-action-dock");
  }

  /** The preflight review dialog, once the CTA opens it. */
  preflight() {
    return this.page.locator(".preflight-overlay");
  }

  /** Open the preflight from a ready CTA (waits out any transient quote-loading). */
  async openPreflight(): Promise<void> {
    const cta = this.primaryButton();
    await expect(cta).toContainText(/Review transfer/i);
    await cta.click();
    await this.preflight().waitFor({ state: "visible" });
  }

  async confirmPreflight(): Promise<void> {
    await this.page.locator(".preflight-confirm").click();
  }

  async cancelPreflight(): Promise<void> {
    await this.page.locator(".preflight-cancel").click();
  }

  /** Full submit path: open the review, then confirm (reaches the wallet). */
  async submit(): Promise<void> {
    await this.openPreflight();
    await this.confirmPreflight();
  }

  /** Inspect the durable receipt format used for reload/recovery. */
  async readActivities(): Promise<Array<Record<string, unknown>>> {
    return this.page.evaluate(
      () => JSON.parse(localStorage.getItem("miden.bridge.ui.activities.v2") ?? "[]") as Array<Record<string, unknown>>,
    );
  }

}
