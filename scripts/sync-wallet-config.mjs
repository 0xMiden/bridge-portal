#!/usr/bin/env node
/** Resolve a reviewed revision once; replace the current files only after both networks validate. */
import { readFile, writeFile, rename } from "node:fs/promises";
import { arcMainnet, arcTestnet } from "../src/config/arc.ts";
import { bridgeConfigSchema, walletDocumentSchema } from "../src/config/wallet-config/schema.ts";
import { midenNetworks } from "../src/config/environment.ts";
import { createPublicClient, erc20Abi, http, parseAbi } from "viem";
import { AccountId, AccountStorageRequirements, Endpoint, RpcClient, SlotAndKeys } from "@miden-sdk/miden-sdk";
import { assertTokenConnections, tokenConnectionsSchema } from "../src/config/wallet-config/token-connections.ts";
const tokenRegistry = tokenConnectionsSchema.parse(JSON.parse(await readFile(
  new URL("../src/config/wallet-config/token-connections.json", import.meta.url), "utf8",
)));
function storageValue(proof, name) {
    const value = proof.getStorageSlotValue(name);
    if (!value)
        throw new Error(`Missing storage slot: ${name}`);
    return value.toU64s();
}
/** Resolve deployment metadata from the live registries; no historical output is written. */
async function deriveWalletConfig(source) {
    const { document, environment } = source;
    const rpc = new RpcClient(new Endpoint(midenNetworks[environment].rpcUrl));
    const evmNetwork = environment === "mainnet" ? "ethereum" : "sepolia";
    const bridge = document.supportedEvmChains[evmNetwork]?.bridges.agglayer;
    if (!bridge?.midenBridgeId)
        throw new Error("Missing Agglayer registry.");
    const registrySlot = "agglayer::bridge::faucet_registry_map";
    const metadataSlot = "agglayer::bridge::faucet_metadata_map";
    const proof = await rpc.getAccountProof(AccountId.fromHex(bridge.midenBridgeId), AccountStorageRequirements.fromSlotAndKeysArray([new SlotAndKeys(registrySlot, []), new SlotAndKeys(metadataSlot, [])]));
    const rollupId = Number(storageValue(proof, "agglayer::bridge::network_id")[0]);
    const metadata = new Map((proof.getStorageMapEntries(metadataSlot) ?? []).map(entry => [entry.key().toU64s().join(":"), entry.value().toU64s()]));
    const native = (proof.getStorageMapEntries(registrySlot) ?? []).flatMap(entry => {
        if (entry.value().toU64s()[0] !== 1n)
            return [];
        const [, , suffix, prefix] = entry.key().toU64s();
        const lo = metadata.get(`0:0:${suffix}:${prefix}`) ?? [0n, 0n, 0n, 0n];
        const hi = metadata.get(`1:0:${suffix}:${prefix}`);
        if (!hi || [...lo, hi[0], hi[1]].some(value => value !== 0n))
            return [];
        return [{ faucetId: `0x${prefix.toString(16).padStart(16, "0")}${(suffix >> 8n).toString(16).padStart(14, "0")}`,
                decimals: 18 - Number(hi[2]) }];
    });
    if (native.length !== 1 || native[0].decimals < 0 || native[0].decimals > 18 || !Number.isSafeInteger(rollupId) || rollupId <= 0)
        throw new Error("Unable to resolve native ETH from the Miden bridge registry");
    let agglayerTokens;
    if (environment === "mainnet") {
        const ethereum = createPublicClient({ transport: http(process.env.ETHEREUM_RPC_URL?.trim() || "https://ethereum-rpc.publicnode.com", { timeout: 15_000, retryCount: 0 }) });
        if (await ethereum.getChainId() !== 1)
            throw new Error("Expected an Ethereum mainnet RPC");
        const registered = (proof.getStorageMapEntries(registrySlot) ?? []).flatMap(entry => {
            if (entry.value().toU64s()[0] !== 1n)
                return [];
            const [, , suffix, prefix] = entry.key().toU64s();
            const lo = metadata.get(`0:0:${suffix}:${prefix}`) ?? [0n, 0n, 0n, 0n];
            const hi = metadata.get(`1:0:${suffix}:${prefix}`);
            if (!hi || hi[1] !== 0n || hi[3] !== 0n || [...lo, hi[0]].some(value => value > 0xffffffffn))
                return [];
            const address = `0x${[...lo, hi[0]].map(value => value.toString(16).padStart(8, "0").match(/../g).reverse().join("")).join("")}`;
            return [{ address, scale: Number(hi[2]),
                    faucetId: `0x${prefix.toString(16).padStart(16, "0")}${(suffix >> 8n).toString(16).padStart(14, "0")}` }];
        });
        agglayerTokens = [];
        for (const [symbol, { contractAddress: listed }] of Object.entries(bridge.tokens ?? {})) {
            const address = listed.toLowerCase();
            const connection = tokenRegistry[environment].find(pair => pair.provider === "agglayer" &&
                pair.evm.network === evmNetwork && pair.evm.kind === "erc20" && pair.evm.address.toLowerCase() === address);
            if (!connection)
                throw new Error(`Missing local token connection for ${symbol}`);
            const matches = registered.filter(token => token.address === address);
            if (matches.length !== 1)
                throw new Error(`Expected one registered mainnet faucet for ${symbol}`);
            const { faucetId, scale } = matches[0];
            const [decimals, chainSymbol, name, faucet] = await Promise.all([
                ethereum.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
                ethereum.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
                ethereum.readContract({ address, abi: erc20Abi, functionName: "name" }),
                rpc.getAccountProof(AccountId.fromHex(faucetId), AccountStorageRequirements.fromSlotAndKeysArray([])),
            ]);
            const midenDecimals = Number(storageValue(faucet, "miden::standards::faucets::fungible::token_config")[2]);
            const owner = storageValue(faucet, "miden::standards::access::ownable2step::owner_config");
            const bridgePrefix = BigInt(bridge.midenBridgeId.slice(0, 18));
            const bridgeSuffix = BigInt(`0x${bridge.midenBridgeId.slice(18)}00`);
            // This Ethereum wrapped SOL contract publishes SOL as its symbol.
            if (chainSymbol !== (symbol === "WSOL" ? "SOL" : symbol) ||
                !Number.isInteger(midenDecimals) || midenDecimals < 0 || midenDecimals > 18 ||
                decimals - scale !== midenDecimals || owner[0] !== bridgeSuffix || owner[1] !== bridgePrefix ||
                faucetId !== connection.miden.faucetId || decimals !== connection.evm.decimals || midenDecimals !== connection.miden.decimals)
                throw new Error(`Unexpected metadata or bridge owner for ${symbol}`);
            agglayerTokens.push({ symbol, name, address, decimals, faucetId, midenDecimals });
        }
    }
    return { ...source, derived: { ...source.derived, rollupId, eth: native[0], ...(agglayerTokens ? { agglayerTokens } : {}) } };
}

const revision = process.argv[2];
if (process.argv.length !== 3 || !/^[a-f0-9]{40}$/.test(revision ?? "")) {
  throw new Error("Usage: npm run config:update -- <40-character wallet-config commit SHA>");
}
const configs = await Promise.all(["testnet", "mainnet"].map(async environment => {
  const response = await fetch(
    `https://raw.githubusercontent.com/0xMiden/wallet-config/${revision}/${environment}.json`,
    { signal: AbortSignal.timeout(15_000), redirect: "error" },
  );
  if (!response.ok) throw new Error(`Wallet-config request failed (${response.status}).`);
  const document = walletDocumentSchema.parse(await response.json());
  if (document.network !== environment) throw new Error("Wrong wallet-config network");
  const arc = environment === "mainnet" ? arcMainnet : arcTestnet;
  const chain = environment === "mainnet" ? "arc" : "arc-testnet";
  const usdcx = document.supportedEvmChains[chain]?.bridges.usdcx;
  if (usdcx?.deposit?.route !== "xreserve" || !usdcx.tokens?.USDC) throw new Error("Missing Circle registry");
  const client = createPublicClient({ transport: http(arc.rpcUrls.default.http[0], { timeout: 15_000, retryCount: 0 }) });
  if (await client.getChainId() !== arc.id) throw new Error("Unexpected Arc RPC network");
  const remote = await client.readContract({
    address: usdcx.deposit.xReserve,
    abi: parseAbi(["function getRemoteToken(uint32,address) view returns (bytes32)"]),
    functionName: "getRemoteToken",
    args: [document["bridge-providers"].usdcx.midenDomain, usdcx.tokens.USDC.contractAddress],
  });
  if (!/^0x0{32}[\da-f]{30}00$/i.test(remote)) throw new Error("Invalid Circle remote token");
  const config = bridgeConfigSchema.parse(await deriveWalletConfig({
    schemaVersion: 1, id: `${environment}:${document.version}`, environment, document,
    derived: { usdcxFaucetId: `0x${remote.slice(34, 64)}`.toLowerCase() },
  }));
  assertTokenConnections(config, tokenRegistry[environment]);
  return { revision, ...config };
}));
// Fetching and verification finish before either existing file is replaced.
for (const config of configs) {
  const target = new URL(`../src/config/wallet-config/${config.environment}.json`, import.meta.url);
  const temporary = new URL(`${target.href}.tmp`);
  await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`);
  await rename(temporary, target);
  console.log(`${config.environment}: config v${config.document.version}, rollup ${config.derived.rollupId}, revision ${revision}`);
}
