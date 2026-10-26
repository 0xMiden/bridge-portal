import { test, expect } from "@playwright/test";
import { startOnTestnet } from "../../fixtures/testnet";
import { stubNetwork } from "../../fixtures/mock-network";
import { DEMO_ACTIVITIES } from "../../../src/app/lib/activity-demo";
import { findBridgeRoute } from "../../../src/bridge/core/routes";

for (const width of [1440, 390]) {
test(`${width}px receipt navigation preserves the header and returns to the expanded activity list at its scroll position`, async ({ page }) => {
  await startOnTestnet(page);
  await stubNetwork(page);
  await page.setViewportSize({ width, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const activities = Array.from({ length: 12 }, (_, index) => ({
    ...DEMO_ACTIVITIES["demo-agglayer-receive"],
    id: `history-${index}`,
    summary: `Transfer ${index + 1}`,
    environment: "testnet",
    routeSnapshot: findBridgeRoute("agglayer-eth-to-miden"),
    updatedAt: Date.now() - index * 1000,
  }));
  await page.addInitScript(activities => {
    localStorage.setItem("miden.bridge.ui.activities.v2", JSON.stringify(activities));
  }, activities);
  await page.goto("/");
  const logo = await page.getByRole("link", { name: "Miden bridge home" }).elementHandle();
  const headerBounds = () => page.getByRole("banner", { includeHidden: true }).evaluate(element => {
    const { x, width } = element.getBoundingClientRect();
    return { x, width };
  });
  const initialHeaderBounds = await headerBounds();
  await page.getByRole("tab", { name: "Activity", exact: true }).click();
  await page.getByRole("button", { name: "Show all 12 transfers" }).click();
  await expect.poll(headerBounds).toEqual(initialHeaderBounds);
  const row = page.getByRole("link", { name: /Transfer 11 / });
  await row.scrollIntoViewIfNeeded();
  const scrollY = await page.evaluate(() => window.scrollY);
  expect(scrollY).toBeGreaterThan(0);
  await row.click();
  await expect(page.getByRole("article", { name: "Transfer receipt" })).toBeVisible();
  // The global navigation stays mounted when only the route content changes.
  expect(await logo!.evaluate(element => element.isConnected)).toBe(true);
  await expect.poll(headerBounds).toEqual(initialHeaderBounds);
  await page.getByRole("link", { name: "Activity", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Activity", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "Show less" })).toBeVisible();
  await expect.poll(() => page.evaluate(expected => Math.abs(window.scrollY - expected), scrollY)).toBeLessThan(2);
  await expect(row).toBeInViewport();
  await row.click();
  await expect(page.getByRole("article", { name: "Transfer receipt" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("tab", { name: "Activity", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => page.evaluate(expected => Math.abs(window.scrollY - expected), scrollY)).toBeLessThan(2);
  await row.click();
  await page.getByRole("link", { name: "New transfer", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Bridge", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("textbox", { name: "Amount", exact: true })).toHaveValue("");
  await expect.poll(headerBounds).toEqual(initialHeaderBounds);
});
}
