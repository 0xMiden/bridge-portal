import type { Page } from "@playwright/test";

// Mock-tier network stubbing via Playwright route interception (no service
// worker needed): fulfills the same-origin /api/* routes and aborts external
// provider chatter so the tier is deterministic and offline. Shares spec-shape
// with the real tier but NEVER shares its fixtures (§2).
export async function stubNetwork(
  page: Page,
  opts: { usdcBalance?: string } = {},
): Promise<void> {
  const usdcBalance = opts.usdcBalance ?? "1";

  await page.route("**/api/sepolia/gas**", (route) =>
    route.fulfill({
      json: { gasPriceWei: "1200000000", gwei: "1.2" },
    }),
  );

  await page.route("**/api/sepolia/balance**", (route) =>
    route.fulfill({
      json: {
        balance: usdcBalance,
        balanceWei: "1000000000000000000",
        balanceEth: "1",
      },
    }),
  );

  await page.route("**/api/sepolia/transaction**", (route) =>
    route.fulfill({
      json: { hash: `0x${"ab".repeat(32)}`, status: "confirmed", success: true },
    }),
  );

  await page.route("**/api/agglayer/**", (route) =>
    route.fulfill({ json: { deposits: [] } }),
  );

  // Epoch allocator: abort so quotes don't hit the real network (the app just
  // shows "no quote" — it doesn't block the flows under test).
  await page.route(/epochprotocol\.xyz/, (route) => route.abort());
  // NOTE: do NOT block the Reown/web3modal config endpoints — AppKit awaits its
  // config fetch during init, and aborting it prevents the injected EVM
  // connector from ever connecting (window.__E2E__.ready stays false).
}
