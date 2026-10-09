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

test("Agglayer withdrawals stay disabled for saved selections and launch links", async ({ bridge, page }) => {
  await page.evaluate(() => {
    localStorage.setItem("miden.bridge.ui.route", "agglayer");
    localStorage.setItem("miden.bridge.ui.mode", "send");
    localStorage.setItem("miden.bridge.ui.route.id", "agglayer-eth-to-sepolia");
  });
  await page.reload();
  await bridge.waitForReady();
  await expect(bridge.routeTrigger()).toContainText("Agglayer");
  await expect(page.locator(".mode-switch button[aria-pressed='true']")).toHaveText("Receive");

  for (const query of ["mode=send", "intent=withdraw"]) {
    await page.goto(`/?provider=agglayer&${query}`);
    await bridge.waitForReady();
    await expect(bridge.routeTrigger()).toContainText("Agglayer");
    await expect(page.locator(".mode-switch button[aria-pressed='true']")).toHaveText("Receive");
    const send = page.locator(".mode-switch").getByRole("button", { name: "Send", exact: true });
    await expect(send).toBeDisabled();
    await expect(send).toHaveAttribute("title", "Agglayer withdrawals are not available yet");
  }
  expect(await bridge.readActivities()).toEqual([]);
});
