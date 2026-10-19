import { test, expect } from "../../fixtures/bridge";

test("Agglayer receive: select, restore and submit a deposit", async ({ bridge, page }) => {
  await bridge.setRoute("AggLayer");
  await page.reload();
  await bridge.waitForReady();
  await expect(bridge.selectedProvider()).toContainText("Agglayer");
  await expect(page.locator(".mode-switch button[aria-pressed='true']"))
    .toHaveText("Deposit");

  await page.goto("/?provider=agglayer&mode=receive");
  await bridge.waitForReady();
  await expect(bridge.selectedProvider()).toContainText("Agglayer");
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

test("Agglayer withdrawal: select, restore, launch and submit to Sepolia", async ({ bridge, page }) => {
  await bridge.setRoute("AggLayer");
  const withdraw = page.locator(".mode-switch").getByRole("button", { name: "Withdraw", exact: true });
  await expect(withdraw).toBeEnabled();
  await bridge.setMode("Send");
  await page.reload();
  await bridge.waitForReady();
  await expect(bridge.selectedProvider()).toContainText("Agglayer");
  await expect(withdraw).toHaveAttribute("aria-pressed", "true");

  await page.goto("/?provider=agglayer&mode=receive");
  await bridge.waitForReady();
  await expect(page.locator(".mode-switch button[aria-pressed='true']")).toHaveText("Deposit");

  await page.goto("/?provider=agglayer&mode=send");
  await bridge.waitForReady();
  await expect(bridge.selectedProvider()).toContainText("Agglayer");
  await expect(withdraw).toHaveAttribute("aria-pressed", "true");
  await bridge.showMidenBalance();
  await bridge.fillAmount("0.01");
  await bridge.submit();
  await bridge.waitForActivityPage();

  const [activity] = await bridge.readActivities();
  expect(activity).toMatchObject({
    provider: "agglayer",
    routeId: "agglayer-eth-to-sepolia",
    mode: "send",
    amount: "0.01",
    asset: "ETH",
    destination: await page.evaluate(() => window.__E2E__!.evmAddress!),
    sourceNetworkId: 73,
    destinationNetworkId: 0,
  });
  expect(activity.midenTxId).toMatch(/^0x[0-9a-fA-F]{64}$/);
});
