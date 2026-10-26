import type { Page } from "@playwright/test";
import { decodeFunctionData, encodeFunctionResult, parseAbi, parseUnits } from "viem";
import { currentBridgeConfig } from "../../src/config/bridge-config";
import { arcConfig, xReserveAbi } from "../../src/bridge/providers/xreserve/config";
import { arcRecipient } from "../../src/bridge/providers/xreserve/deposit-terms";

// Intercept remote boundaries while the browser runs the production application.
export async function stubNetwork(
  page: Page,
  opts: { usdcBalance?: string } = {},
): Promise<void> {
  const usdcBalance = opts.usdcBalance ?? "1";
  // Keep normal AppKit discovery, with no dependency on a Reown project/account.
  await page.route("https://api.web3modal.org/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/appkit/v1/config") return route.fulfill({ json: { features: [] } });
    if (path === "/getWallets") return route.fulfill({ json: { data: [], count: 0 } });
    if (path === "/projects/v1/origins") return route.fulfill({ json: { allowedOrigins: [new URL(page.url()).origin] } });
    return route.abort();
  });
  await page.route(/https:\/\/(?:rpc|pulse)\.walletconnect\.org\//, route => route.abort());
  await page.route("**/api/prices?**", (route) => {
    const symbol = new URL(route.request().url()).searchParams.get("symbol");
    return route.fulfill({ json: { symbol, usd: symbol === "ETH" ? 3200.5 : 0.9998, fetchedAt: Date.now() } });
  });

  await page.route("**/api/evm/*/gas**", (route) =>
    route.fulfill({
      json: { gasPriceWei: "1200000000", gwei: "1.2" },
    }),
  );

  await page.route("**/api/evm/*/balance**", (route) => {
    const params = new URL(route.request().url()).searchParams;
    const balance = params.has("token") ? usdcBalance : "1";
    const decimals = Number(params.get("decimals") ?? 18);
    return route.fulfill({ json: { balance, balanceRaw: parseUnits(balance, decimals).toString() } });
  });

  await page.route("**/api/evm/sepolia/transaction**", (route) =>
    route.fulfill({
      json: { hash: `0x${"ab".repeat(32)}`, status: "confirmed", success: true },
    }),
  );

  await page.route("**/api/agglayer/**", (route) => {
    const url = new URL(route.request().url());
    const json = url.pathname.endsWith("/withdrawal") ? { exitHashes: [] } : {
      destinationAddress: url.searchParams.get("destinationAddress"), deposits: [], latestDeposit: null,
    };
    return route.fulfill({ json });
  });

  // Unconfigured quote providers are unavailable; individual scenarios supply
  // their responses without contacting the live allocators.
  await page.route(/epochprotocol\.xyz/, (route) => route.abort());
  await page.route(/\/api\/xreserve\/(?:quote|withdrawal-quote)$/, route =>
    route.fulfill({ status: 503, json: { error: "Quote unavailable" } }));
  // Faucet metadata is unavailable in these UI scenarios; production fallback
  // uses configured precision. WASM canonicalization still runs normally.
  await page.route(/https:\/\/rpc\.(?:testnet|devnet|cedar)\.miden\.(?:io|xyz)/, route => route.abort());
  await page.route("**/api/evm/*/rpc", route => {
    const { id, method, params } = route.request().postDataJSON();
    const abi = [...xReserveAbi, ...parseAbi(["function isEmergencyState() view returns (bool)"])];
    if (method === "eth_call") {
      try {
        const { functionName } = decodeFunctionData({ abi, data: params[0].data });
        const environment = route.request().url().includes("/arc/rpc") ? "mainnet" : "testnet";
        const values: Record<string, unknown> = {
          isEmergencyState: false, isRemoteDomainRegistered: true,
          getRemoteToken: arcRecipient(arcConfig(currentBridgeConfig(environment)).faucetId),
        };
        if (functionName in values) return route.fulfill({ json: { jsonrpc: "2.0", id,
          result: encodeFunctionResult({ abi, functionName, result: values[functionName] as never }),
        } });
      } catch { /* Unconfigured reads remain unavailable. */ }
    }
    return route.fulfill({ json: { jsonrpc: "2.0", id, error: { code: -32601, message: "RPC response not configured for this scenario" } } });
  });
}
