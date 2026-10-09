import { test, expect } from "../../fixtures/bridge";

test("Agglayer receive: select, restore and submit a deposit", async ({ bridge, page }) => {
  await bridge.setRoute("AggLayer");
  await page.reload();
  await bridge.waitForReady();
  await expect(bridge.routeTrigger()).toContainText("Agglayer");
  await expect(page.locator(".mode-switch button[aria-pressed='true']"))
    .toHaveText("Receive");

  await page.goto("/?provider=agglayer&mode=receive");
  await bridge.waitForReady();
  await expect(bridge.routeTrigger()).toContainText("Agglayer");
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

test("Agglayer send: select, restore, launch and submit a withdrawal", async ({ bridge, page }) => {
  await bridge.setRoute("AggLayer");
  await bridge.setMode("Send");
  await page.reload();
  await bridge.waitForReady();
  await expect(bridge.routeTrigger()).toContainText("Agglayer");
  await expect(page.locator(".mode-switch button[aria-pressed='true']")).toHaveText("Send");

  for (const query of ["mode=send", "intent=withdraw"]) {
    await bridge.setMode("Receive");
    await page.goto(`/?provider=agglayer&${query}`);
    await bridge.waitForReady();
    await expect(bridge.routeTrigger()).toContainText("Agglayer");
    await expect(page.locator(".mode-switch button[aria-pressed='true']")).toHaveText("Send");
  }
  expect(await bridge.readActivities()).toEqual([]);

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
    sourceNetworkId: 73,
    destinationNetworkId: 0,
    midenTxId: `0x${"cd".repeat(32)}`,
  });
});
