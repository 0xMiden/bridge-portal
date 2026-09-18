import { existsSync, readFileSync } from "node:fs";

const ETH_FLOOR_WEI = 10n ** 15n; // 0.001 ETH

function loadDotEnv(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = value;
  }
}

export default async function globalSetup() {
  loadDotEnv(".env.e2e");

  if (!process.env.E2E_EVM_PRIVATE_KEY) {
    throw new Error(
      "E2E_EVM_PRIVATE_KEY is required for live testnet E2E (throwaway Sepolia key).",
    );
  }
  if (!process.env.E2E_MIDEN_ACCOUNT_ID) {
    throw new Error(
      "E2E_MIDEN_ACCOUNT_ID is required (funded Miden testnet account, bech32 or 0x).",
    );
  }

  const rpc =
    process.env.E2E_SEPOLIA_RPC_URL ??
    "https://ethereum-sepolia-rpc.publicnode.com";
  const { privateKeyToAccount } = await import("viem/accounts");
  const account = privateKeyToAccount(
    process.env.E2E_EVM_PRIVATE_KEY as `0x${string}`,
  );
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getBalance",
      params: [account.address, "latest"],
    }),
  });
  if (!res.ok) {
    throw new Error(`Sepolia RPC ${rpc} returned ${res.status} while checking the E2E ETH floor.`);
  }
  const payload = (await res.json()) as { result?: string; error?: { message?: string } };
  if (!payload.result) {
    throw new Error(payload.error?.message ?? "Sepolia RPC did not return a balance.");
  }
  const wei = BigInt(payload.result);
  if (wei < ETH_FLOOR_WEI) {
    throw new Error(
      `E2E Sepolia account ${account.address} is below 0.001 ETH (${wei} wei). Top up from a faucet.`,
    );
  }
}
