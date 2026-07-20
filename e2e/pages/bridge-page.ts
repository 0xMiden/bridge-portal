import { expect, type Page } from "@playwright/test";

// Capability interface (§4): the same specs drive the bridge through this
// page-object regardless of target (local dev server vs preview deploy).
export type Route = "AggLayer" | "Epoch";
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
    await this.page.locator(".route-trigger").click();
    await this.page
      .locator(".route-options-menu")
      .getByText(route, { exact: false })
      .first()
      .click();
    // Case-insensitive: the semantic route name ("AggLayer") differs from the
    // UI label casing ("Agglayer", lowercase L).
    await expect(this.page.locator(".route-trigger")).toContainText(
      new RegExp(route, "i"),
    );
  }

  async setMode(mode: Mode): Promise<void> {
    await this.page
      .locator(".mode-switch button", { hasText: mode })
      .click();
  }

  async fillAmount(amount: string): Promise<void> {
    const input = this.page.locator(".swap-box input[aria-label='Amount']");
    await input.fill(amount);
  }

  async fillDestination(value: string): Promise<void> {
    await this.page.locator(".destination-input input").fill(value);
  }

  primaryButton() {
    return this.page.locator(".primary-button");
  }

  async submit(): Promise<void> {
    await this.primaryButton().click();
  }

  /** The first Current-transfer activity row, once one appears. */
  async waitForActivityRow(timeout = 120_000) {
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
