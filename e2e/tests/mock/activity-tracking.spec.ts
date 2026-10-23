import { findBridgeRoute } from "../../../src/bridge/core/routes";
import { expect, test, type Page } from "@playwright/test";
import type { Activity } from "../../../src/app/lib/bridge-presentation";
import { stubNetwork } from "../../fixtures/mock-network";
import { startOnTestnet } from "../../fixtures/testnet";

const STORAGE_KEY = "miden.bridge.ui.activities.v2";
const SOURCE_TX = `0x${"ab".repeat(32)}`;
const EXIT_HASH = `0x${"ef".repeat(32)}`;
const DESTINATION_TX = `0x${"cd".repeat(32)}`;
const EVM_ADDRESS = `0x${"12".repeat(20)}`;
const MIDEN_ADDRESS = "mtst1aqk5t00kapdcnq2yyf77dz6xcyssweun_qr7qqq9wr6w";
const MIDEN_ACCOUNT_HEX = `0x${"34".repeat(15)}`;

async function openActivity(page: Page, overrides: Partial<Activity>) {
  const activity: Activity = {
    id: "act-tracking",
    provider: "agglayer",
    mode: "send",
    amount: "1",
    asset: "ETH",
    summary: "Send 1 ETH to Sepolia",
    status: "source_finality",
    eta: "30-90 min",
    txHash: SOURCE_TX,
    sourceTxHash: SOURCE_TX,
    destination: EVM_ADDRESS,
    midenAccountHex: MIDEN_ACCOUNT_HEX,
    updatedAt: Date.now(),
    ...overrides,
  };
  const provider = activity.provider;
  const routeId = provider === "epoch" ? `epoch-test-usdc-to-${activity.mode === "receive" ? "miden" : "sepolia"}`
    : `agglayer-eth-to-${activity.mode === "receive" ? "miden" : "sepolia"}`;
  activity.routeSnapshot ??= findBridgeRoute(routeId)!;
  activity.asset = activity.routeSnapshot.source.symbol;
  activity.environment = "testnet";
  await page.evaluate(({ key, activity }) => {
    localStorage.setItem(key, JSON.stringify([activity]));
  }, { key: STORAGE_KEY, activity });
  await page.goto(`/activity/${activity.id}`);
  await expect(page.locator(".detail-simple")).toBeVisible();
  return activity;
}

async function storedActivity(page: Page): Promise<Activity> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!)[0], STORAGE_KEY);
}

test.beforeEach(async ({ page }) => {
  await startOnTestnet(page);
  await stubNetwork(page);
  await page.goto("/");
});

for (const mode of ["send", "receive"] as const) {
  test(`Epoch ${mode} resumes after reload and waits for the destination leg`, async ({ page }) => {
    let settled = false;
    let reads = 0;
    const sourceChainId = mode === "send" ? 999999999 : 11155111;
    const destinationChainId = mode === "send" ? 11155111 : 999999999;
    await page.route("**/intentStatus/**", async (route) => {
      reads++;
      await route.fulfill({ json: [
        { chainId: sourceChainId, status: "success", transactionHash: SOURCE_TX },
        {
          chainId: destinationChainId,
          status: settled ? "success" : "pending",
          transactionHash: settled ? DESTINATION_TX : "",
        },
      ] });
    });
    await openActivity(page, {
      provider: "epoch",
      mode,
      asset: "USDC",
      destination: mode === "send" ? EVM_ADDRESS : MIDEN_ADDRESS,
      midenTxId: mode === "send" ? SOURCE_TX : undefined,
      epochIntentNonce: "42",
      epochSponsor: EVM_ADDRESS,
    });

    await expect.poll(async () => (await storedActivity(page)).status).toBe("message_observed");
    expect((await storedActivity(page)).destinationTxHash).toBeUndefined();
    const readsBeforeReload = reads;
    await page.reload();
    await expect.poll(() => reads).toBeGreaterThan(readsBeforeReload);
    settled = true;

    await expect.poll(async () => (await storedActivity(page)).status).toBe("complete");
    const activity = await storedActivity(page);
    expect(activity.sourceTxHash).toBe(SOURCE_TX);
    expect(activity.destinationTxHash).toBe(DESTINATION_TX);
    expect(activity.midenTxId).toBe(mode === "send" ? SOURCE_TX : DESTINATION_TX);
    expect(activity.destinationTxAt).toBeGreaterThan(0);
    const destinationPath = mode === "send" ? `/tx/${DESTINATION_TX}` : `/account/${MIDEN_ACCOUNT_HEX}`;
    await expect(page.locator(`a[href$="${destinationPath}"]`)).toBeVisible();
  });
}

test("Agglayer receive recovers the delayed Miden transaction after reload", async ({ page }, testInfo) => {
  let delivered = false;
  let claimTxHash: string | undefined = undefined;
  await page.route("**/api/agglayer/deposits**", (route) => {
    const unrelatedDeposit = { tx_hash: DESTINATION_TX, ready_for_claim: true, deposit_cnt: 99 };
    const deposit = {
      tx_hash: SOURCE_TX.toUpperCase().replace("0X", "0x"),
      ready_for_claim: delivered,
      claim_tx_hash: claimTxHash,
      deposit_cnt: 42,
    };
    return route.fulfill({ json: {
      destinationAddress: EVM_ADDRESS,
      deposits: [unrelatedDeposit, deposit],
      latestDeposit: unrelatedDeposit,
    } });
  });
  await openActivity(page, {
    mode: "receive",
    destination: MIDEN_ADDRESS,
    bridgeDestinationAddress: EVM_ADDRESS,
  });
  await expect.poll(async () => (await storedActivity(page)).status).toBe("message_observed");
  expect((await storedActivity(page)).depositCount).toBe("42");

  delivered = true;
  await expect.poll(async () => (await storedActivity(page)).status).toBe("complete");
  expect((await storedActivity(page)).midenTxId).toBeUndefined();
  const receipt = page.getByRole("article", { name: "Transfer receipt" });
  await expect(receipt.getByText("Delivered", { exact: true })).toBeVisible();
  await expect(receipt.getByText("Wallet claim", { exact: true })).toBeVisible();
  await expect(receipt.getByText("Ready to claim", { exact: true })).toHaveCount(0);
  await expect(receipt.getByText(/If you already consumed the note in Bread/)).toBeVisible();
  await expect(receipt.getByText("No provider fee", { exact: true })).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1100 });
    await expect(receipt.getByText("Network fee · estimated", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`journey-${width}.png`), fullPage: true });
  }
  await page.reload();
  await expect(page.locator(".detail-simple")).toBeVisible();
  claimTxHash = DESTINATION_TX;
  await expect.poll(async () => (await storedActivity(page)).midenTxId).toBe(DESTINATION_TX);
  expect((await storedActivity(page)).sourceTxHash?.toLowerCase()).toBe(SOURCE_TX);
  await expect(page.locator(`a[href$="/account/${MIDEN_ACCOUNT_HEX}"]`)).toBeVisible();
});

test("Agglayer send follows the stored exit through automatic settlement", async ({ page }) => {
  let claimed = false;
  await page.route("**/api/bridges/**", (route) => route.fulfill({ json: {
    deposits: [
      { network_id: 73, dest_net: 0, dest_addr: EVM_ADDRESS, tx_hash: SOURCE_TX, deposit_cnt: 99, claim_tx_hash: SOURCE_TX },
      {
        network_id: 73,
        dest_net: 0,
        deposit_cnt: 42,
        dest_addr: EVM_ADDRESS,
        tx_hash: EXIT_HASH,
        ready_for_claim: !claimed,
        claim_tx_hash: claimed ? DESTINATION_TX : "",
      },
    ],
  } }));
  await openActivity(page, { depositCount: "42", agglayerExitHashes: [EXIT_HASH] });
  await expect.poll(async () => (await storedActivity(page)).status).toBe("claim_available");
  expect((await storedActivity(page)).destinationTxHash).toBeUndefined();
  claimed = true;
  await expect.poll(async () => (await storedActivity(page)).status).toBe("complete");
  expect((await storedActivity(page)).destinationTxHash).toBe(DESTINATION_TX);
  await expect(page.locator(`a[href*="${DESTINATION_TX}"]`).first()).toBeVisible();
});

for (const provider of ["epoch", "agglayer"] as const) {
  test(`${provider} cancels pending tracking when leaving the activity`, async ({ page }) => {
    await page.clock.install();
    let reads = 0;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const handled = Promise.withResolvers<void>();
    const pattern = provider === "epoch" ? "**/intentStatus/**" : "**/api/bridges/**";
    await page.route(pattern, async (route) => {
      reads++;
      await pending;
      await route.fulfill({ json: provider === "epoch"
        ? [{ chainId: 999999999, status: "success", transactionHash: SOURCE_TX }]
        : { deposits: [{ network_id: 73, dest_net: 0, dest_addr: EVM_ADDRESS, tx_hash: EXIT_HASH, deposit_cnt: 42, ready_for_claim: true }] },
      });
      handled.resolve();
    });
    await openActivity(page, {
      provider,
      epochIntentNonce: provider === "epoch" ? "42" : undefined,
      epochSponsor: provider === "epoch" ? EVM_ADDRESS : undefined,
      agglayerExitHashes: provider === "agglayer" ? [EXIT_HASH] : undefined,
    });
    await expect.poll(() => reads).toBeGreaterThan(0);
    const before = await storedActivity(page);
    await page.getByRole("link", { name: "New transfer", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    release();
    // Aborted fetches emit no response. Wait for the mock handler instead;
    // the SDK path can still deliver a late response after navigation.
    await handled.promise;
    const readsAfterLeaving = reads;
    await page.clock.runFor(20_000);
    expect(await storedActivity(page)).toEqual(before);
    expect(reads).toBe(readsAfterLeaving);
  });
}

test("activity history is loading before storage is read, then resolves missing", async ({ page }) => {
  await page.addInitScript((key) => {
    const getItem = Storage.prototype.getItem;
    Storage.prototype.getItem = function (name) {
      if (name === key && !getItem.call(sessionStorage, "before-history-read")) {
        const initialState = document.querySelector(".detail-empty")?.textContent;
        if (initialState) sessionStorage.setItem("before-history-read", initialState);
      }
      return getItem.call(this, name);
    };
  }, STORAGE_KEY);
  await page.goto("/activity/unknown-activity");
  await expect(page.getByRole("heading", { name: "Activity not found" })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("before-history-read")))
    .toBe("Loading activity…");
});

test("diagnostics copies the displayed activity and resets its confirmation", async ({ context, page }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/activity/demo-failed");
  await page.getByRole("button", { name: "Copy diagnostics" }).click();
  await expect(page.getByRole("button", { name: "Diagnostics copied" })).toBeVisible();
  const bundle = await page.evaluate(async () => JSON.parse(await navigator.clipboard.readText()));
  expect(bundle.activityId).toBe("demo-failed");
  expect(bundle.status).toBe("failed");
  await expect(page.getByRole("button", { name: "Copy diagnostics" })).toBeVisible();
});

test("a receipt from an earlier release sends its saved recovery data when tracking", async ({ page }) => {
  const historical = structuredClone(findBridgeRoute("agglayer-eth-to-miden")!);
  historical.recovery.document.version--;
  historical.recovery.id = `testnet:${historical.recovery.document.version}`;
  historical.recovery.document.supportedEvmChains.sepolia!.bridges.agglayer!.contractAddress = `0x${"22".repeat(20)}`;
  await page.route("**/api/agglayer/deposits**", route => {
    expect(route.request().postDataJSON().recovery).toEqual(historical.recovery);
    const deposit = { tx_hash: SOURCE_TX, ready_for_claim: true, claim_tx_hash: DESTINATION_TX, deposit_cnt: 42 };
    return route.fulfill({ json: { destinationAddress: EVM_ADDRESS, deposits: [deposit], latestDeposit: deposit } });
  });
  await openActivity(page, { routeSnapshot: historical, mode: "receive", destination: MIDEN_ADDRESS, bridgeDestinationAddress: EVM_ADDRESS });
  await expect.poll(async () => (await storedActivity(page)).status).toBe("complete");
  await expect(page.getByRole("article", { name: "Transfer receipt" })).toBeVisible();
  expect((await storedActivity(page)).routeSnapshot?.recovery).toEqual(historical.recovery);
});
