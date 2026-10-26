import { expect, test } from "@playwright/test";
import { stubNetwork } from "../../fixtures/mock-network";
import { startOnTestnet } from "../../fixtures/testnet";
import { BridgePage } from "../../pages/bridge-page";

test("USD estimates follow the amount and selected token, and pricing failures stay unavailable", async ({ page }) => {
  await startOnTestnet(page);
  await stubNetwork(page);
  await page.route("**/api/xreserve/*quote", (route) => route.fulfill({ status: 502, json: { error: "Quote unavailable" } }));
  await page.goto("/?provider=agglayer&mode=receive");
  await new BridgePage(page).waitForReady();
  const amount = page.getByRole("textbox", { name: "Amount", exact: true });
  const source = page.locator('.swap-box[data-side="source"] .fiat-amount');
  const destination = page.locator('.swap-box[data-side="destination"] .fiat-amount');
  await expect(source).toHaveText("$0.00");
  await amount.fill("2");
  await expect(source).toHaveText("$6,401.00");
  await expect(destination).toHaveText("$6,401.00");
  await amount.fill("0.5");
  await expect(source).toHaveText("$1,600.25");
  await expect(destination).toHaveText("$1,600.25");

  await page.locator('.swap-box[data-side="source"] .token-select-trigger').click();
  await page.getByRole("option", { name: "USDC Circle USDC", exact: true }).click();
  await amount.fill("1000");
  await expect(source).toHaveText("$999.80");
  await expect(destination).toHaveText("—");
  await page.getByRole("button", { name: "Reverse transfer direction" }).click();
  await amount.fill("1000");
  await expect(source).toHaveText("$999.80");
  // Withdrawal fees require a quote; an unknown payout must not copy the source.
  await expect(destination).toHaveText("—");

  await page.route("**/api/prices?**", (route) => route.fulfill({ status: 502, json: { error: "Price unavailable" } }));
  await page.reload();
  await amount.fill("2");
  await expect(source).toHaveText("—");
  await expect(source).toHaveAttribute("title", /unavailable/);
  await amount.fill("");
  await expect(source).toHaveText("$0.00");
});
