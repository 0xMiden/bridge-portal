import { expect, type Page } from "@playwright/test";

// Capability interface (§4): the same specs drive the bridge through this
// page-object regardless of target (local dev server vs preview deploy).
export type Route = "AggLayer" | "Epoch" | "USDCx";
export type Mode = "Receive" | "Send";

export class BridgePage {
  constructor(private readonly page: Page) {}

  /** Wait until both injected wallets have connected (window.__E2E__.ready). */
  async waitForReady(timeout = 120_000): Promise<void> {
    await this.page.waitForFunction(() => window.__E2E__?.ready === true, null, {
      timeout,
    });
  }

  async setRoute(route: Route): Promise<void> {
    // Assets/networks define the route; the provider picker only contains
    // compatible providers and must never silently switch assets.
    if (!new RegExp(route, "i").test((await this.selectedProvider().textContent()) ?? "")) {
      await this.setChain("Sepolia");
      await this.page.locator(".token-select-trigger").first().click();
      const token = route === "AggLayer" ? "ETH Ether" : route === "USDCx" ? "USDC Circle USDC" : "USDC USD Coin";
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

  /** Opt-in Miden balance fetch (AggLayer send needs the resolved ETH faucet). */
  async showMidenBalance(): Promise<void> {
    const button = this.page.locator("button.balance-show");
    if ((await button.count()) === 0) return;
    await button.click();
    await expect(this.page.locator("button.balance-show")).toHaveCount(0, {
      timeout: 20_000,
    });
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

  /** The first Current-transfer activity row, once one appears. */
  async waitForActivityRow(timeout = 120_000) {
    await this.page.getByRole("tab", { name: /Activity/ }).click();
    const row = this.page.locator(".home-activity-item").first();
    await row.waitFor({ state: "visible", timeout });
    return row;
  }

  async openActivity(): Promise<void> {
    await (await this.waitForActivityRow()).click();
    await this.page.locator(".detail-simple").waitFor({ state: "visible" });
  }

  /** Read persisted activities via the gated window hook. */
  async readActivities(): Promise<Array<Record<string, unknown>>> {
    return this.page.evaluate(
      () => (window.__E2E__?.readActivities() ?? []) as Array<Record<string, unknown>>,
    );
  }

  async statusBadgeText(): Promise<string> {
    return (await this.page.locator(".status-badge").first().textContent()) ?? "";
  }
}
