import { expect, test, type Page } from "@playwright/test";
import type { Activity } from "../../../src/app/lib/bridge-presentation";
import { stubNetwork } from "../../fixtures/mock-network";

const STORAGE_KEY = "miden.bridge.ui.activities";
const SOURCE_TX = `0x${"ab".repeat(32)}`;
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

test("Agglayer receive recovers the delayed Miden transaction after reload", async ({ page }) => {
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
      { network_id: 1, dest_net: 0, deposit_cnt: 99, claim_tx_hash: SOURCE_TX },
      {
        network_id: 1,
        dest_net: 0,
        deposit_cnt: 42,
        ready_for_claim: !claimed,
        claim_tx_hash: claimed ? DESTINATION_TX : "",
      },
    ],
  } }));
  await openActivity(page, { depositCount: "42" });
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
    const pattern = provider === "epoch" ? "**/intentStatus/**" : "**/api/bridges/**";
    await page.route(pattern, async (route) => {
      reads++;
      await pending;
      await route.fulfill({ json: provider === "epoch"
        ? [{ chainId: 999999999, status: "success", transactionHash: SOURCE_TX }]
        : { deposits: [{ network_id: 1, dest_net: 0, deposit_cnt: 42, ready_for_claim: true }] },
      });
    });
    await openActivity(page, {
      provider,
      epochIntentNonce: provider === "epoch" ? "42" : undefined,
      epochSponsor: provider === "epoch" ? EVM_ADDRESS : undefined,
    });
    await expect.poll(() => reads).toBeGreaterThan(0);
    const before = await storedActivity(page);
    await page.getByRole("link", { name: "New transfer", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    const response = page.waitForResponse(pattern);
    release();
    await response;
    const readsAfterLeaving = reads;
    await page.clock.runFor(20_000);
    expect(await storedActivity(page)).toEqual(before);
    expect(reads).toBe(readsAfterLeaving);
  });
}
