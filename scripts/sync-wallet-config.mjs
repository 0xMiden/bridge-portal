/**
 * Import a reviewed wallet-config revision and verify its Miden deployments.
 * Usage: node scripts/sync-wallet-config.mjs <40-character commit SHA>
 * Old snapshots stay in the bundle so saved receipts keep their original config.
 */
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { createPublicClient, http, parseAbi } from "viem";
import { AccountId, AccountStorageRequirements, Endpoint, RpcClient, SlotAndKeys } from "@miden-sdk/miden-sdk";

const revision = process.argv[2];
if (!/^[a-f0-9]{40}$/.test(revision ?? "")) throw new Error("Supply a reviewed wallet-config commit SHA.");
const output = new URL("../src/config/wallet-config/snapshots.json", import.meta.url);
const snapshots = await readFile(output, "utf8").then(JSON.parse).catch(error => {
  if (error.code === "ENOENT") return [];
  throw error;
});
const chainIds = { sepolia: 11155111, "arc-testnet": 5042002, "base-sepolia": 84532, "arbitrum-sepolia": 421614,
  ethereum: 1, arc: 5042, base: 8453, arbitrum: 42161 };
const address = value => /^0x[\da-f]{40}$/i.test(value);
const account = value => /^0x[\da-f]{30}$/i.test(value);
const https = value => {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("Invalid service URL");
};
const abi = parseAbi(["function getRemoteToken(uint32,address) view returns (bytes32)"]);
for (const environment of ["testnet", "mainnet"]) {
  const id = `${environment}-${revision}`;
  if (snapshots.some(snapshot => snapshot.id === id)) continue;
  const response = await fetch(`https://raw.githubusercontent.com/0xMiden/wallet-config/${revision}/${environment}.json`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`wallet-config ${environment}: ${response.status}`);
  const document = await response.json();
  if (document.network !== environment || !Number.isSafeInteger(document.version) || document.version < 1)
    throw new Error("Invalid network document");
  const previous = snapshots.findLast(snapshot => snapshot.environment === environment);
  if (previous && document.version < previous.document.version) throw new Error("Refusing a config version downgrade");
  for (const [network, chain] of Object.entries(document.supportedEvmChains)) {
    if (chain.chainId !== chainIds[network] || (environment === "testnet") !== /sepolia|testnet/.test(network))
      throw new Error(`Unexpected chain ${network}`);
    for (const [provider, bridge] of Object.entries(chain.bridges)) {
      if (provider === "agglayer" && network !== (environment === "mainnet" ? "ethereum" : "sepolia"))
        throw new Error("This portal supports Agglayer only on Ethereum L1 / Sepolia");
      if (provider === "usdcx") {
        const arc = environment === "mainnet" ? "arc" : "arc-testnet";
        if (bridge.domain !== { ethereum: 0, sepolia: 0, base: 6, "base-sepolia": 6, arbitrum: 3, "arbitrum-sepolia": 3, arc: 26, "arc-testnet": 26 }[network])
          throw new Error("Unexpected Circle domain");
        if (network === arc ? bridge.deposit?.route !== "xreserve" : bridge.deposit?.route !== "executor" || bridge.deposit?.executorChain !== arc)
          throw new Error("Unsupported Circle deposit path");
      }
      if (typeof bridge.depositEnabled !== "boolean" || typeof bridge.withdrawalEnabled !== "boolean")
        throw new Error("Missing direction switches");
      if (bridge.contractAddress && !address(bridge.contractAddress)) throw new Error("Invalid bridge address");
      if (bridge.midenBridgeId && !account(bridge.midenBridgeId)) throw new Error("Invalid Miden bridge");
      if (bridge.tokens?.USDC && !address(bridge.tokens.USDC.contractAddress)) throw new Error("Invalid USDC address");
      if (bridge.deposit) for (const key of ["xReserve", "tokenMessenger", "tokenMessengerWithFees"]) {
        if (bridge.deposit[key] && !address(bridge.deposit[key])) throw new Error(`Invalid ${key}`);
      }
      if (bridge.executor && (!address(bridge.executor.address) || !address(bridge.executor.handler)))
        throw new Error("Invalid Circle executor");
    }
  }
  for (const provider of Object.values(document["bridge-providers"]))
    for (const [key, value] of Object.entries(provider))
      if (key.endsWith("Url")) https(value);

  const rpcUrl = environment === "mainnet" ? "https://rpc.cedar.miden.io" : "https://rpc.testnet.miden.io";
  const rpc = new RpcClient(new Endpoint(rpcUrl));
  const evmNetwork = environment === "mainnet" ? "ethereum" : "sepolia";
  const bridge = document.supportedEvmChains[evmNetwork].bridges.agglayer;
  const registrySlot = "agglayer::bridge::faucet_registry_map";
  const metadataSlot = "agglayer::bridge::faucet_metadata_map";
  const proof = await rpc.getAccountProof(AccountId.fromHex(bridge.midenBridgeId),
    AccountStorageRequirements.fromSlotAndKeysArray([new SlotAndKeys(registrySlot, []), new SlotAndKeys(metadataSlot, [])]));
  const rollupId = Number(proof.getStorageSlotValue("agglayer::bridge::network_id").toU64s()[0]);
  const metadata = new Map(proof.getStorageMapEntries(metadataSlot).map(entry => [entry.key().toU64s().join(":"), entry.value().toU64s()]));
  const native = proof.getStorageMapEntries(registrySlot).flatMap(entry => {
    if (entry.value().toU64s()[0] !== 1n) return [];
    const [, , suffix, prefix] = entry.key().toU64s();
    const lo = metadata.get(`0:0:${suffix}:${prefix}`) ?? [0n, 0n, 0n, 0n];
    const hi = metadata.get(`1:0:${suffix}:${prefix}`);
    if (!hi || [...lo, hi[0], hi[1]].some(value => value !== 0n)) return [];
    return [{ faucetId: `0x${prefix.toString(16).padStart(16, "0")}${(suffix >> 8n).toString(16).padStart(14, "0")}`,
      decimals: 18 - Number(hi[2]) }];
  });
  if (native.length !== 1 || native[0].decimals < 0 || native[0].decimals > 18 || !Number.isSafeInteger(rollupId) || rollupId <= 0)
    throw new Error("Unable to resolve native ETH from the Miden bridge registry");
  const arcNetwork = environment === "mainnet" ? "arc" : "arc-testnet";
  const usdcx = document.supportedEvmChains[arcNetwork].bridges.usdcx;
  const evm = createPublicClient({ transport: http(environment === "mainnet" ? "https://rpc.mainnet.arc.io" : "https://rpc.testnet.arc.io", {
    timeout: 15_000, retryCount: 0,
  }) });
  const remote = await evm.readContract({ address: usdcx.deposit.xReserve, abi, functionName: "getRemoteToken",
    args: [document["bridge-providers"].usdcx.midenDomain, usdcx.tokens.USDC.contractAddress] });
  if (!/^0x0{32}[\da-f]{30}00$/i.test(remote)) throw new Error("Invalid Circle remote token");
  const usdcxFaucetId = `0x${remote.slice(34, 64)}`.toLowerCase();
  snapshots.push({ id, revision, environment, document, derived: { rpcUrl, rollupId, eth: native[0], usdcxFaucetId } });
  console.log(`${environment}: config v${document.version}, rollup ${rollupId}, ETH ${native[0].faucetId}, USDCx ${usdcxFaucetId}`);
}
await mkdir(new URL("../src/config/wallet-config/", import.meta.url), { recursive: true });
const temporary = new URL(`./snapshots.${process.pid}.tmp`, output);
await writeFile(temporary, `${JSON.stringify(snapshots, null, 2)}\n`);
await rename(temporary, output);
