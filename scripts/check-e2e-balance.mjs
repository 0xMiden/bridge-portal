#!/usr/bin/env node
import { privateKeyToAccount } from "viem/accounts";

const ETH_FLOOR_WEI = 10n ** 15n; // 0.001 ETH

const key = process.env.E2E_EVM_PRIVATE_KEY;
if (!key) {
  console.log("check-e2e-balance: E2E_EVM_PRIVATE_KEY unset, skip");
  process.exit(0);
}

const rpc =
  process.env.E2E_SEPOLIA_RPC_URL ??
  "https://ethereum-sepolia-rpc.publicnode.com";
const account = privateKeyToAccount(key);
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
  console.error(`Sepolia RPC ${rpc} returned ${res.status}`);
  process.exit(1);
}
const payload = await res.json();
if (!payload.result) {
  console.error(payload.error?.message ?? "no balance result");
  process.exit(1);
}
const wei = BigInt(payload.result);
if (wei < ETH_FLOOR_WEI) {
  console.error(
    `E2E Sepolia account ${account.address} is below 0.001 ETH (${wei} wei). Top up from a faucet.`,
  );
  process.exit(1);
}
console.log(
  `check-e2e-balance: ok ${account.address} has ${wei} wei`,
);
