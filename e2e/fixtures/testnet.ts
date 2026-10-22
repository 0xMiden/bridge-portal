import type { Page } from "@playwright/test";

// Transfer scenarios use testnet wallets and routes, independent of the app's
// default. Preserve explicit switches across reloads within each scenario.
export async function startOnTestnet(page: Page) {
  await page.addInitScript(() => {
    const key = "miden.bridge.ui.environment";
    if (sessionStorage.getItem(key) === null) sessionStorage.setItem(key, "testnet");
  });
}
