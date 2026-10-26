import { acceptAgglayerDeposit } from "../../fixtures/deposit";
import { EVM_ADDRESS } from "../../fixtures/wallets";
import { test, expect } from "../../fixtures/bridge";

test("Agglayer receive: select, restore and submit a deposit", async ({ bridge, page }) => {
  await bridge.setRoute("AggLayer");
  await page.reload();
  await bridge.waitForReady();
  await bridge.expectRoute("agglayer");
  await expect(page.locator(".mode-switch button[aria-pressed='true']"))
    .toHaveText("Deposit");

  await page.goto("/?provider=agglayer&mode=receive");
  await bridge.waitForReady();
  await bridge.expectRoute("agglayer");
  acceptAgglayerDeposit(page);
  await bridge.fillAmount("0.01");
  await bridge.submit();
  await bridge.waitForActivityPage();

  const [activity] = await bridge.readActivities();
  expect(activity).toMatchObject({
    provider: "agglayer",
    routeId: "agglayer-eth-to-miden",
    mode: "receive",
    sourceNetworkId: 0,
    destinationNetworkId: 73,
  });
  expect(activity.sourceTxHash)
    .toMatch(/^0x[0-9a-fA-F]{64}$/);
});

test("Agglayer withdrawal: select, restore and review a Sepolia withdrawal", async ({ bridge, page }) => {
  await bridge.setRoute("AggLayer");
  const withdraw = page.locator(".mode-switch").getByRole("button", { name: "Withdraw", exact: true });
  await expect(withdraw).toBeEnabled();
  await bridge.setMode("Send");
  await page.reload();
  await bridge.waitForReady();
  await bridge.expectRoute("agglayer");
  await expect(withdraw).toHaveAttribute("aria-pressed", "true");

  await page.goto("/?provider=agglayer&mode=receive");
  await bridge.waitForReady();
  await expect(page.locator(".mode-switch button[aria-pressed='true']")).toHaveText("Deposit");

  await page.goto("/?provider=agglayer&mode=send");
  await bridge.waitForReady();
  await bridge.expectRoute("agglayer");
  await expect(withdraw).toHaveAttribute("aria-pressed", "true");
  await bridge.fillAmount("0.01");
  await bridge.openPreflight();
  await expect(page.locator("#preflight-destination-value")).toHaveAttribute("title", EVM_ADDRESS);
  await expect(bridge.preflight()).toContainText("0.01 ETH");
  await bridge.cancelPreflight();
  expect(await bridge.readActivities()).toEqual([]);
});
