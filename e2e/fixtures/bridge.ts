import { test as base, expect } from "@playwright/test";
import { stubNetwork } from "./mock-network";
import { BridgePage } from "../pages/bridge-page";

// Boots the bridge page-object: register the mock-network stubs, navigate, and
// wait for the gated `window.__E2E__.ready` hook (both injected wallets
// connected). Failure diagnostics come from Playwright's built-in
// trace/screenshot/video (see playwright.mock.config.ts) — no custom harness.
export const test = base.extend<{ bridge: BridgePage }>({
  bridge: async ({ page }, use) => {
    const bridge = new BridgePage(page);
    if (process.env.E2E_NETWORK === "mock") await stubNetwork(page);
    await page.goto("/");
    await bridge.waitForReady().catch(() => undefined);
    await use(bridge);
  },
});

export { expect };
