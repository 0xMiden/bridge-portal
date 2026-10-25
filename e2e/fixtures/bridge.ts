import { test as base, expect } from "@playwright/test";
import { stubNetwork } from "./mock-network";
import { BridgePage } from "../pages/bridge-page";
import { startOnTestnet } from "./testnet";

// Real app providers; extensions and remote responses are supplied by Playwright.
export const test = base.extend<{ bridge: BridgePage }>({
  bridge: async ({ page }, use) => {
    const bridge = new BridgePage(page);
    await startOnTestnet(page);
    await stubNetwork(page);
    await page.goto("/");
    await bridge.waitForReady();
    await use(bridge);
  },
});

export { expect };
