import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { decodeFunctionData, parseAbi } from "viem";
import path from "node:path";
import { BridgePage } from "../../pages/bridge-page";
import { stubNetwork } from "../../fixtures/mock-network";
import { installPhantom, RECIPIENT, RECIPIENT_ADDRESS, SOURCE_ACCOUNT, type WalletMode } from "../../helper/phantom";
import fixture from "../../fixtures/cctp-helper-public.json";

const deployment = fixture[0];
const control = process.env.HELPER_FIXTURE_CONTROL_URL;
if (!control || new URL(control).hostname !== "127.0.0.1") throw new Error("Owned loopback fixtures are required.");
const callAbi = parseAbi(["function receiveAndDeposit(bytes message,bytes attestation)"]);
const notice = "A separate transaction on Arc is still required. USDCx has not been delivered.";
type FixtureState = {
  sends: { signature: string; bytes: string }[];
  simulations: { bytes: string }[];
  calls: { kind: string; method: string; params?: unknown[] }[];
};
async function scenario(request: APIRequestContext, changes: Record<string, unknown>, reset = false) {
  const response = await request.post(`${control}/${reset ? "reset" : "scenario"}`, { data: changes });
  expect(response.ok()).toBe(true);
}
async function fixtureState(request: APIRequestContext): Promise<FixtureState> {
  const response = await request.get(`${control}/state`);
  expect(response.ok()).toBe(true); return response.json();
}
async function connectBread(page: Page) {
  const control = page.locator('[data-wallet="miden"] .wallet-pill');
  await expect(control).toBeVisible();
  if (await control.getAttribute("data-connected") !== "true") {
    await control.click();
    const connect = page.getByRole("menuitem", { name: "Connect wallet", exact: true });
    const disconnect = page.getByRole("menuitem", { name: "Disconnect", exact: true });
    await expect(connect.or(disconnect)).toBeVisible();
    if (await connect.isVisible()) await connect.click(); else await page.keyboard.press("Escape");
  }
  await expect(control).toHaveAttribute("data-connected", "true");
  await page.evaluate(address => window.testWallets.changeMidenAccount(address), RECIPIENT_ADDRESS);
}
async function openSolana(page: Page, mode: WalletMode = "normal") {
  const signatures = await installPhantom(page, mode);
  await stubNetwork(page);
  await page.goto("/");
  const bridge = new BridgePage(page);
  await bridge.setChain("Solana Devnet");
  await connectBread(page);
  await page.getByRole("button", { name: "Connect Phantom (Solana)", exact: true }).click();
  if (mode !== "missing-sign-only") {
    await expect(page.getByRole("button", { name: `Disconnect Phantom (Solana): ${SOURCE_ACCOUNT}`, exact: true })).toBeVisible();
    await bridge.fillAmount("1");
  }
  return { bridge, signatures };
}
async function pendingIsNotDelivered(page: Page) {
  await expect(page.getByText(notice, { exact: false })).toBeVisible();
  await expect(page.getByText("USDCx note delivered", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /burn again|refund|change recipient/i })).toHaveCount(0);
}
async function readSavedHelper(bridge: BridgePage) {
  const rows = await bridge.readActivities();
  expect(rows).toHaveLength(1);
  const helper = rows[0].cctpHelper as {
    attemptId: string; stage: string; signature?: string; signedBytes?: string;
    authorization: { sourceAccount: string; grossAmount: string; midenRecipient: string; maxCctpFee: string; deploymentId: string };
  };
  expect(helper.authorization.sourceAccount).toBe(SOURCE_ACCOUNT);
  expect(helper.authorization.grossAmount).toBe("1000000");
  expect(helper.authorization.midenRecipient).toBe(RECIPIENT);
  expect(helper.authorization.deploymentId).toBe(deployment.deploymentId);
  expect(rows[0].status).toBe("source_finality");
  return { row: rows[0], helper };
}

test.describe("Solana manual source and Arc handoff", () => {
  let manualHttpStatuses: Record<string, number> = {};
  test.beforeEach(async ({ page, request }) => {
    // All cases share the real per-deployment 180 RPC/minute limit. Space their
    // synthetic bursts instead of weakening or bypassing production admission.
    await new Promise(resolve => setTimeout(resolve, 30_000));
    await scenario(request, {}, true);
    manualHttpStatuses = {};
    page.on("response", response => {
      const url = new URL(response.url());
      if (!url.pathname.startsWith("/api/cctp-helper/manual/")) return;
      const key = `${url.pathname} ${response.status()}`;
      manualHttpStatuses[key] = (manualHttpStatuses[key] ?? 0) + 1;
    });
  });
  test.afterEach(async ({ page }, info) => {
    await info.attach("manual-http-statuses", { body: JSON.stringify({ url: page.url(), statuses: manualHttpStatuses }, null, 2), contentType: "application/json" });
    expect(Object.keys(manualHttpStatuses).filter(key => key.endsWith(" 429")), "Every case must reach its intended boundary without rate-limit interference").toEqual([]);
  });

  for (const width of [320, 1280]) {
    test(`${width}px keeps the irreversible review warning visible above Confirm with expanded addresses`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const { bridge, signatures } = await openSolana(page);
      await bridge.openPreflight();
      await page.locator("#preflight-source-value").click();
      await page.locator("#preflight-destination-value").click();
      const warning = page.locator(".preflight-actions .preflight-note");
      const confirm = bridge.preflight().getByRole("button", { name: "Confirm in wallet", exact: true });
      await expect(warning).toContainText(/irreversible/i); await expect(warning).toContainText(/no refund/i);
      await expect(warning).toBeInViewport({ ratio: 1 }); await expect(confirm).toBeInViewport({ ratio: 1 });
      const warningBox = await warning.boundingBox(), confirmBox = await confirm.boundingBox();
      expect(warningBox!.y + warningBox!.height).toBeLessThanOrEqual(confirmBox!.y);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      expect(signatures).toHaveLength(0);
      await page.screenshot({ path: path.join(process.env.HELPER_BROWSER_RUN_ROOT!, `manual-review-warning-${width}.png`), fullPage: true, animations: "disabled" });
    });
  }

  test("real signatures, finalized source and authenticated manual bundle preserve review identity", async ({ page, request }) => {
    const { bridge, signatures } = await openSolana(page);
    const screenshots = process.env.HELPER_BROWSER_RUN_ROOT!;
    await expect(bridge.primaryButton()).toHaveText("Review transfer");
    await page.screenshot({ path: path.join(screenshots, "happy-source-selection.png"), fullPage: true, animations: "disabled" });
    await bridge.openPreflight();
    await expect(page.locator("#preflight-source-value")).toHaveAttribute("title", SOURCE_ACCOUNT);
    await expect(page.locator("#preflight-destination-value")).toHaveAttribute("title", RECIPIENT_ADDRESS);
    await page.locator("#preflight-source-value").click();
    await page.locator("#preflight-destination-value").click();
    await expect(bridge.preflight()).toContainText("0.99999 USDCx");
    await expect(bridge.preflight()).toContainText("0.00001 USDC");
    await expect(bridge.preflight()).toContainText(/irreversible/i);
    await expect(bridge.preflight()).toContainText(/Arc gas/i);
    await expect(bridge.preflight()).toContainText(/no refund|refund or recipient change/i);
    await page.screenshot({ path: path.join(screenshots, "happy-transfer-review.png"), fullPage: true, animations: "disabled" });
    await bridge.confirmPreflight();
    await bridge.waitForActivityPage();
    await expect(page.getByRole("article", { name: "Transfer receipt", exact: true }).getByText("Ready for manual Arc execution", { exact: true })).toBeVisible();
    await pendingIsNotDelivered(page);
    await page.screenshot({ path: path.join(screenshots, "happy-manual-ready.png"), fullPage: true, animations: "disabled" });
    const { helper } = await readSavedHelper(bridge);
    const state = await fixtureState(request);
    expect(signatures).toHaveLength(1);
    expect(state.sends).toHaveLength(1);
    expect(state.sends[0].bytes).toBe(signatures[0].signedBytes);
    expect(state.simulations.length).toBeGreaterThan(0);
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download manual Arc call", exact: true }).click();
    const download = await downloadPromise;
    await download.saveAs(path.join(screenshots, "happy-manual-call.json"));
    const stream = await download.createReadStream();
    const chunks: Buffer[] = []; for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString("utf8"), bundle = JSON.parse(raw);
    expect(bundle.execution).toBe("manual");
    expect(bundle.source.sourceTransaction).toBe(helper.signature);
    expect(bundle.source.sourceAccount).toBe(SOURCE_ACCOUNT);
    expect(bundle.source.grossAmount).toBe("1000000");
    expect(bundle.source.midenRecipient).toBe(RECIPIENT);
    expect(bundle.source.sourceEventIds).toEqual([`solana:${helper.signature}:0:2`]);
    expect(bundle.maxCctpFee).toBe("10"); expect(bundle.feeExecuted).toBe("0"); expect(bundle.netAmount).toBe("1000000");
    expect(bundle.call.to).toBe(deployment.helper.address); expect(bundle.call.value).toBe("0");
    const call = decodeFunctionData({ abi: callAbi, data: bundle.call.data });
    expect(call.functionName).toBe("receiveAndDeposit"); expect(call.args).toEqual([bundle.message, bundle.attestation]);
    expect(bundle.notice).toBe(notice);
    expect(raw).not.toMatch(/signedBytes|secretKey|privateKey|solanaRpc|arcRpc|irisApi/);
    expect(raw).not.toContain(signatures[0].signedBytes);
    // Export revalidates an already-ready receipt instead of trusting an old bundle.
    await scenario(request, { helperSimulationFails: true });
    const unexpectedDownloads: string[] = [];
    page.on("download", item => unexpectedDownloads.push(item.suggestedFilename()));
    await page.getByRole("button", { name: "Download manual Arc call", exact: true }).click();
    await expect(page.getByText(/not currently validated/i)).toBeVisible();
    expect(unexpectedDownloads).toEqual([]);
  });

  test("post-sign Gateway pause preserves the saved packet and recovery only resends those bytes", async ({ page, request }) => {
    const { bridge, signatures } = await openSolana(page);
    await page.route("**/api/cctp-helper/manual/rpc?*", async route => {
      if (route.request().postDataJSON().method === "sendTransaction") {
        await scenario(request, { policy: { functionName: "paused", target: deployment.arc.gatewayWallet.address, value: true } });
      }
      await route.continue();
    });
    await bridge.openPreflight(); await bridge.confirmPreflight(); await bridge.waitForActivityPage();
    const { helper } = await readSavedHelper(bridge);
    expect(signatures).toHaveLength(1); expect(helper.signedBytes).toBe(signatures[0].signedBytes);
    expect((await fixtureState(request)).sends).toHaveLength(0);
    await page.unroute("**/api/cctp-helper/manual/rpc?*");
    await scenario(request, { policy: null });
    await page.getByRole("button", { name: "Retry saved source transaction", exact: true }).click();
    await expect(page.getByRole("button", { name: "Download manual Arc call", exact: true })).toBeVisible();
    const state = await fixtureState(request);
    expect(state.sends).toHaveLength(1); expect(state.sends[0].bytes).toBe(signatures[0].signedBytes);
    expect(signatures).toHaveLength(1); await pendingIsNotDelivered(page);
  });
  test("lost send response and reload recover one saved signed attempt without another wallet burn", async ({ page, request }) => {
    await scenario(request, { lostSend: true, finalized: false });
    const { bridge, signatures } = await openSolana(page);
    await bridge.submit();
    await expect.poll(async () => (await fixtureState(request)).sends.length).toBe(1);
    const before = await readSavedHelper(bridge);
    expect(before.helper.signedBytes).toBe(signatures[0].signedBytes);
    const signature = before.helper.signature;
    const attemptId = before.helper.attemptId;
    await page.reload();
    await scenario(request, { finalized: true });
    await expect(page.getByRole("article", { name: "Transfer receipt", exact: true }).getByText("Ready for manual Arc execution", { exact: true })).toBeVisible();
    const after = await readSavedHelper(bridge);
    expect(after.helper.attemptId).toBe(attemptId); expect(after.helper.signature).toBe(signature);
    expect(signatures).toHaveLength(1);
    const sends = (await fixtureState(request)).sends;
    expect(sends.every(send => send.signature === signature && send.bytes === signatures[0].signedBytes)).toBe(true);
    await pendingIsNotDelivered(page);
  });

  for (const barrier of ["reviewed", "signed"] as const) {
    test(`actual storage refusal at ${barrier} barrier prevents the next irreversible step`, async ({ page, request }) => {
      const { bridge, signatures } = await openSolana(page);
      await bridge.openPreflight();
      await page.evaluate(value => { window.helperFixture.storageFailure = value; }, barrier);
      await bridge.confirmPreflight();
      await expect(page.getByRole("alert").filter({ hasText: barrier === "signed"
        ? "The signed transaction could not be saved. Nothing was broadcast."
        : "The reviewed attempt could not be saved. Phantom was not asked to sign." })).toBeVisible();
      expect((await fixtureState(request)).sends).toHaveLength(0);
      expect(signatures).toHaveLength(barrier === "reviewed" ? 0 : 1);
      expect(await page.evaluate(() => window.helperFixture.walletCalls)).toBe(barrier === "reviewed" ? 0 : 1);
      await expect(page.getByRole("button", { name: "Download manual Arc call", exact: true })).toHaveCount(0);
      const attempt = await page.evaluate(() => window.helperFixture.storageWrites[0].attemptId);
      await page.evaluate(() => { window.helperFixture.storageFailure = "none"; });
      await bridge.submit();
      await bridge.waitForActivityPage();
      await expect(page.getByRole("article", { name: "Transfer receipt", exact: true }).getByText("Ready for manual Arc execution", { exact: true })).toBeVisible();
      expect((await readSavedHelper(bridge)).helper.attemptId).toBe(attempt);
      expect(signatures).toHaveLength(1);
      expect((await fixtureState(request)).sends).toEqual([{ signature: (await readSavedHelper(bridge)).helper.signature, bytes: signatures[0].signedBytes }]);
      const attempts = await page.evaluate(() => window.helperFixture.storageWrites.map(row => row.attemptId));
      expect(new Set(attempts).size).toBe(1);
    });
  }

  for (const mode of ["reject", "unsupported", "changed-message", "dropped-event", "changed-provider", "changed-account"] as const) {
    test(`Phantom ${mode} cannot broadcast or export`, async ({ page, request }) => {
      const { bridge } = await openSolana(page, mode);
      await bridge.submit();
      await expect.poll(() => page.evaluate(() => window.helperFixture.walletCalls)).toBe(1);
      await expect(page.getByText(/rejected|unsupported|changed|signatures|sign-only|Review again|review again/i).last()).toBeVisible();
      expect((await fixtureState(request)).sends).toHaveLength(0);
      await expect(page.getByRole("button", { name: "Download manual Arc call", exact: true })).toHaveCount(0);
    });
  }

  test("missing Phantom sign-only capability cannot request a signature", async ({ page, request }) => {
    await openSolana(page, "missing-sign-only");
    await expect(page.getByText(/does not support sign-only/i)).toBeVisible();
    expect(await page.evaluate(() => window.helperFixture.walletCalls)).toBe(0);
    expect((await fixtureState(request)).sends).toHaveLength(0);
  });

  test("higher fee after review requires a fresh review before any wallet call", async ({ page, request }) => {
    const { bridge, signatures } = await openSolana(page);
    await bridge.openPreflight();
    await scenario(request, { feeBps: "1" });
    await bridge.confirmPreflight();
    await expect(page.getByText(/fee.*changed|review again|renew.*review/i).last()).toBeVisible();
    expect(signatures).toHaveLength(0); expect((await fixtureState(request)).sends).toHaveLength(0);
  });

  test("source simulation refusal blocks the wallet before a burn", async ({ page, request }) => {
    const { bridge, signatures } = await openSolana(page);
    await bridge.openPreflight();
    // A valid quote exists; reject the fresh exact-transaction simulation at
    // confirmation, immediately before the wallet would be asked to sign.
    await scenario(request, { sourceSimulationFails: true });
    await bridge.confirmPreflight();
    await expect(page.getByRole("alert").filter({ hasText: "The exact Solana burn simulation failed." })).toBeVisible();
    expect(signatures).toHaveLength(0); expect((await fixtureState(request)).sends).toHaveLength(0);
  });

  test("invalid source, attestation policy, cryptography or helper simulation never supplies an export", async ({ page, request }) => {
    await scenario(request, { attestationPending: true });
    const { bridge, signatures } = await openSolana(page);
    await bridge.submit(); await bridge.waitForActivityPage();
    await expect.poll(async () => (await fixtureState(request)).sends.length).toBe(1);
    const { helper } = await readSavedHelper(bridge);
    const url = `/api/cctp-helper/manual/attestation?deploymentId=${deployment.deploymentId}&sourceTransaction=${helper.signature}`;
    for (const mutation of ["source-signature", "source-ambiguous", "source-hook", "source-account", "envelope", "amount", "helper", "hook", "finality", "expiry", "ambiguous", "attestation"]) {
      await scenario(request, { mutation, attestationPending: false });
      const response = await page.request.get(url);
      expect(response.ok(), mutation).toBe(true);
      const result = await response.json();
      expect(result.state, mutation).toBe("needs_attention"); expect(result.bundle, mutation).toBeUndefined();
      await expect(page.getByRole("button", { name: "Download manual Arc call", exact: true })).toHaveCount(0);
    }
    await scenario(request, { mutation: "none", helperSimulationFails: true });
    const rejected = await (await page.request.get(url)).json();
    expect(rejected.state).toBe("needs_attention"); expect(rejected.bundle).toBeUndefined();
    expect(signatures).toHaveLength(1); expect((await fixtureState(request)).sends).toHaveLength(1);
  });

  test("expired unknown history remains recoverable attention across reload with no second burn", async ({ page, request }) => {
    await scenario(request, { lostSend: true, finalized: false });
    const { bridge, signatures } = await openSolana(page);
    await bridge.submit(); await expect.poll(async () => (await fixtureState(request)).sends.length).toBe(1);
    const before = await readSavedHelper(bridge);
    await scenario(request, { expired: true }); await page.reload();
    await expect(page.getByText("Source outcome is not yet resolved. Check this attempt; do not burn again.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Refresh status", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry saved source transaction", exact: true })).toBeVisible();
    const after = await readSavedHelper(bridge);
    expect(after.helper.attemptId).toBe(before.helper.attemptId); expect(after.helper.signature).toBe(before.helper.signature);
    expect(signatures).toHaveLength(1); expect((await fixtureState(request)).sends).toHaveLength(1);
    await expect(page.getByRole("button", { name: /burn again|new burn|Download manual Arc call/i })).toHaveCount(0);
  });

  test("equivalent amount formatting after reload cannot bypass an unresolved source attempt", async ({ page, request }) => {
    await scenario(request, { lostSend: true, finalized: false });
    const { bridge, signatures } = await openSolana(page);
    await bridge.submit();
    await expect.poll(async () => (await fixtureState(request)).sends.length).toBe(1);
    const previous = await readSavedHelper(bridge);
    await page.goto("/");
    await bridge.setChain("Solana Devnet");
    await connectBread(page);
    await page.getByRole("button", { name: "Connect Phantom (Solana)", exact: true }).click();
    await bridge.fillAmount("1.0");
    await bridge.submit();
    await expect(page.getByText(/existing|unresolved|recover.*attempt|do not.*burn/i).last()).toBeVisible();
    const current = await readSavedHelper(bridge);
    expect(current.helper.attemptId).toBe(previous.helper.attemptId);
    expect(current.helper.signature).toBe(previous.helper.signature);
    expect(signatures).toHaveLength(1);
    expect((await fixtureState(request)).sends).toHaveLength(1);
  });
});
