import { test, expect } from "@playwright/test";
import { startOnTestnet } from "../../fixtures/testnet";
import { stubNetwork } from "../../fixtures/mock-network";
import { BridgePage } from "../../pages/bridge-page";
import { evmRow, evmMessage, txHash, blockHash } from "../../../src/bridge/providers/xreserve/fixtures/evm/test-fixture";
import { currentBridgeConfig } from "../../../src/config/bridge-config";
import sources from "../../../src/config/cctp-evm-sources.json";
import { evmHelperIntent, evmHelperCallData } from "../../../src/bridge/providers/xreserve/helper-evm-call";
import { evmJournalKey } from "../../../src/bridge/providers/xreserve/helper-evm-journal";
import { evmHelperDeploymentSchema } from "../../../src/config/cctp-evm-helper";

test("all new protocol sources remain unavailable without a qualified deployment", async ({ page }) => {
  await startOnTestnet(page); await stubNetwork(page); await page.goto("/");
  const bridge = new BridgePage(page); await bridge.waitForReady(); let quoteCalls = 0;
  page.on("request", request => { if (request.url().includes("/api/cctp-helper/evm/quote")) quoteCalls++; });
  for (const label of ["Avalanche Fuji", "OP Sepolia", "Sonic Testnet", "Morph Hoodi", "EDGE Testnet", "Pharos Atlantic"]) {
    await bridge.setChain(label);
    await expect(page.getByText("This CCTP source has no qualified manual Arc deployment in this build.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Route unavailable", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Confirm in wallet", exact: false })).toHaveCount(0);
  }
  await bridge.setChain("Hyperliquid EVM Testnet");
  await page.locator('[data-wallet="evm"] .wallet-pill').click();
  await expect(page.getByRole("menuitem", { name: "Copy address", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /View on/ })).toHaveCount(0);
  expect(quoteCalls).toBe(0);
});

test("orphan journals restore both networks and wrong imported candidates remain correctable without a wallet request", async ({ page }) => {
  await startOnTestnet(page); await stubNetwork(page);
  const testnet = { ...evmRow(), attemptId: "browser-orphan-testnet", hash: undefined, hashOrigin: undefined, stage: "wallet_pending" as const };
  const mainnet = structuredClone(testnet), row = sources.find(row => row.network === "ethereum")!;
  mainnet.attemptId = "browser-orphan-mainnet"; mainnet.recovery = currentBridgeConfig("mainnet");
  const d = mainnet.authorization.deployment;
  d.environment = "mainnet"; d.deploymentId = "browser-orphan-mainnet"; d.arc.chainId = 5042; d.miden.faucetId = mainnet.recovery.derived.usdcxFaucetId;
  d.source = { ...d.source, network: "ethereum", chainId: row.chainId, domain: row.domain,
    usdc: { ...d.source.usdc, address: row.usdc as `0x${string}` }, tokenMessenger: { ...d.source.tokenMessenger, address: row.tokenMessenger as `0x${string}` },
    messageTransmitter: { ...d.source.messageTransmitter, address: row.messageTransmitter as `0x${string}` }, tokenMinter: { ...d.source.tokenMinter, address: row.tokenMinter as `0x${string}` } };
  mainnet.authorization.deployment = evmHelperDeploymentSchema.parse(d); mainnet.authorization.deploymentId = d.deploymentId;
  mainnet.intent = evmHelperIntent(mainnet.authorization); mainnet.callData = evmHelperCallData(mainnet.authorization);
  await page.addInitScript(({ key, rows }) => { localStorage.setItem(key, JSON.stringify(rows)); localStorage.setItem("miden.bridge.ui.activities.v2", "{corrupt"); }, { key: evmJournalKey, rows: [testnet, mainnet] });
  let walletRequests = 0;
  page.on("request", request => { if (/\/api\/cctp-helper\/evm\/quote/.test(request.url())) walletRequests++; });
  await page.route("**/api/cctp-helper/evm/attestation", async route => {
    const body = route.request().postDataJSON();
    if (body.hash !== txHash) return route.fulfill({ json: { state: "pending" } });
    const auth = testnet.authorization;
    return route.fulfill({ json: { state: "source_finalized", source: { sourceTransaction: txHash, blockHash, blockNumber: "101", logIndex: 2,
      sourceAccount: auth.sourceAccount, grossAmount: auth.grossAmount, maxCctpFee: auth.maxCctpFee, midenRecipient: auth.midenRecipient, message: evmMessage(auth) } } });
  });
  await page.goto("/recovery"); await page.getByRole("button", { name: "Load saved source attempts" }).click();
  const links = page.getByRole("link", { name: "Recover original attempt", exact: true }); await expect(links).toHaveCount(2);
  await links.nth(1).click(); await expect(page.getByText("Activity not found", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Source wallet request saved", { exact: false }).first()).toBeVisible();
  await page.goto("/recovery"); await page.getByRole("button", { name: "Load saved source attempts" }).click(); await links.first().click();
  const field = page.getByLabel("Original source transaction hash", { exact: true });
  await field.fill(`0x${"de".repeat(32)}`); await page.getByRole("button", { name: "Recheck original source and attestation" }).click();
  await expect(field).toBeVisible(); await field.fill(txHash); await page.getByRole("button", { name: "Recheck original source and attestation" }).click();
  await expect(field).toHaveCount(0);
  await expect(page.getByText("Waiting for Circle Standard attestation", { exact: true }).first()).toBeVisible();
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), evmJournalKey);
  expect(saved.find((row: { attemptId: string }) => row.attemptId === testnet.attemptId).source.sourceTransaction).toBe(txHash);
  const sends = await page.evaluate(() => window.testWallets.requests.filter(request => request.wallet === "evm" && /sendTransaction|signTransaction/.test(request.method)));
  expect(sends).toHaveLength(0); expect(walletRequests).toBe(0);
});
