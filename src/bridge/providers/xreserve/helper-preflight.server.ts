import "server-only";
import { assertManualDestinationPolicy, type DestinationAmounts } from "./helper-destination-policy.server";
import { arcReadTransport } from "./arc-read-transport.server";
import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { createPublicClient, keccak256, pad, parseAbi } from "viem";
import { z } from "zod";
import { type HelperIdentity } from "../../../config/cctp-helper";
import type { HelperServer } from "../../../config/cctp-helper.server";
import { circleProgram, helperSolanaAccounts, readSolanaBalances } from "./helper-solana";
import { assertSolanaGenesis, boundedText, createSolanaConnection } from "../../solana/rpc";
import { arcRecipient } from "./deposit-terms";

import { helperAbi } from "./helper-abi";
export { helperAbi } from "./helper-abi";
export const preflightAbi = parseAbi([
  "function paused() view returns (bool)", "function domainDepositsPaused(uint32) view returns (bool)",
  "function isRemoteDomainRegistered(uint32) view returns (bool)", "function getRemoteToken(uint32,address) view returns (bytes32)",
  "function isTokenSupported(address) view returns (bool)", "function isBlocklisted(uint32,bytes32) view returns (bool)",
  "function isBlacklisted(address) view returns (bool)", "function localDomain() view returns (uint32)", "function version() view returns (uint32)",
  "function messageBodyVersion() view returns (uint32)", "function localMessageTransmitter() view returns (address)",
  "function localMinter() view returns (address)", "function remoteTokenMessengers(uint32) view returns (bytes32)",
  "function getLocalToken(uint32,bytes32) view returns (address)", "function receiveMessage(bytes,bytes) returns (bool)",
]);
export const arcHelperClient = (server: HelperServer) => createPublicClient({ transport: arcReadTransport(server.arcRpc) });
const keyHex = (value: string) => `0x${new PublicKey(value).toBuffer().toString("hex")}` as const;

export async function assertManualDestination(deployment: HelperIdentity, server: HelperServer, recipient: `0x${string}`, amounts: DestinationAmounts) {
  const client = arcHelperClient(server), { arc, helper, miden } = deployment;
  const identity = await client.getChainId();
  if (identity !== arc.chainId || await client.getBlockNumber() < BigInt(helper.deploymentBlock)) throw new Error("Destination chain mismatch.");
  const dependencies = [helper, ...Object.entries(arc).flatMap(([name, value]) =>
    typeof value === "object" && !(amounts.phase === "attested" && name === "gatewayMinter") ? [value] : [])];
  await Promise.all(dependencies.map(async contract => {
    const code = await client.getCode({ address: contract.address });
    if (!code || code === "0x" || keccak256(code) !== contract.runtimeHash) throw new Error("Destination code mismatch.");
  }));
  await assertHelperImmutables(client, deployment);
  const { messageTransmitter: { address: transmitter }, tokenMessenger: { address: messenger }, usdc: { address: usdc }, xReserve: { address: reserve } } = arc;
  const domain = miden.domain, faucet = arcRecipient(miden.faucetId);
  const checks = await Promise.all([
    ...[arc.messageTransmitter.address, arc.tokenMinter.address, arc.usdc.address, arc.xReserve.address].map(address =>
      client.readContract({ address, abi: preflightAbi, functionName: "paused" }).then(value => value === false)),
    client.readContract({ address: reserve, abi: preflightAbi, functionName: "domainDepositsPaused", args: [domain] }).then(value => !value),
    client.readContract({ address: reserve, abi: preflightAbi, functionName: "isRemoteDomainRegistered", args: [domain] }),
    client.readContract({ address: reserve, abi: preflightAbi, functionName: "getRemoteToken", args: [domain, usdc] }).then(value => value === faucet),
    client.readContract({ address: reserve, abi: preflightAbi, functionName: "isTokenSupported", args: [usdc] }),
    client.readContract({ address: reserve, abi: preflightAbi, functionName: "isBlocklisted", args: [domain, recipient] }).then(value => !value),
    ...[helper.address, reserve].map(address => client.readContract({ address: usdc, abi: preflightAbi, functionName: "isBlacklisted", args: [address] }).then(value => !value)),
    client.readContract({ address: transmitter, abi: preflightAbi, functionName: "localDomain" }).then(value => value === 26),
    client.readContract({ address: transmitter, abi: preflightAbi, functionName: "version" }).then(value => value === 1),
    client.readContract({ address: messenger, abi: preflightAbi, functionName: "messageBodyVersion" }).then(value => value === 1),
    client.readContract({ address: messenger, abi: preflightAbi, functionName: "localMessageTransmitter" }).then(value => value.toLowerCase() === arc.messageTransmitter.address),
    client.readContract({ address: messenger, abi: preflightAbi, functionName: "localMinter" }).then(value => value.toLowerCase() === arc.tokenMinter.address),
    client.readContract({ address: messenger, abi: preflightAbi, functionName: "remoteTokenMessengers", args: [5] }).then(value => value === keyHex(deployment.source.tokenMessengerProgram)),
    client.readContract({ address: arc.tokenMinter.address, abi: preflightAbi, functionName: "getLocalToken", args: [5, keyHex(deployment.source.mint)] }).then(value => value.toLowerCase() === arc.usdc.address),
  ]);
  if (checks.some(value => !value)) throw new Error("Destination route is unavailable.");
  await assertManualDestinationPolicy(deployment, client, amounts);
  return client;
}

async function assertHelperImmutables(client: ReturnType<typeof arcHelperClient>, deployment: HelperIdentity) {
  const { arc, helper, miden } = deployment;
  const [transmitter, messenger, usdc, reserve, domain, faucet] = await Promise.all([
    client.readContract({ address: helper.address, abi: helperAbi, functionName: "messageTransmitter" }),
    client.readContract({ address: helper.address, abi: helperAbi, functionName: "tokenMessenger" }),
    client.readContract({ address: helper.address, abi: helperAbi, functionName: "usdc" }),
    client.readContract({ address: helper.address, abi: helperAbi, functionName: "xReserve" }),
    client.readContract({ address: helper.address, abi: helperAbi, functionName: "midenDomain" }),
    client.readContract({ address: helper.address, abi: helperAbi, functionName: "expectedMidenFaucet" }),
  ]);
  if ([transmitter, messenger, usdc, reserve].map(value => value.toLowerCase()).join() !==
    [arc.messageTransmitter.address, arc.tokenMessenger.address, arc.usdc.address, arc.xReserve.address].join() || domain !== miden.domain || faucet !== arcRecipient(miden.faucetId))
    throw new Error("Helper immutable identity mismatch.");
}

export async function readManualSourcePolicy(deployment: HelperIdentity, server: HelperServer, owner: string, amount: bigint) {
  const connection = createSolanaConnection(deployment, server.solanaRpc);
  await assertSolanaGenesis(connection, deployment);
  const accounts = helperSolanaAccounts(deployment, owner, PublicKey.default.toBase58());
  const names = ["messageTransmitter", "tokenMessenger", "remoteTokenMessenger", "tokenMinter", "localToken"] as const;
  const infos = await connection.getMultipleAccountsInfo(names.map(name => accounts[name]), "confirmed");
  const decoded = names.map((name, index) => {
    const info = infos[index];
    const expectedOwner = name === "messageTransmitter" ? accounts.messageTransmitterProgram : accounts.program;
    if (!info || !info.owner.equals(expectedOwner)) throw new Error("Invalid Circle source state owner.");
    return circleProgram().coder.accounts.decode(name, info.data) as unknown;
  });
  const transmitter = z.object({ paused: z.literal(false), localDomain: z.literal(5), version: z.literal(1), maxMessageBodySize: z.instanceof(BN) }).parse(decoded[0]);
  const messenger = z.object({ messageBodyVersion: z.literal(1), minFee: z.number().int().min(0).max(0xffffffff) }).parse(decoded[1]);
  const remote = z.object({ domain: z.literal(26), tokenMessenger: z.instanceof(PublicKey) }).parse(decoded[2]);
  z.object({ paused: z.literal(false) }).parse(decoded[3]);
  const local = z.object({ mint: z.instanceof(PublicKey), burnLimitPerMessage: z.instanceof(BN) }).parse(decoded[4]);
  if (transmitter.maxMessageBodySize.lt(new BN(292)) || remote.tokenMessenger.toBuffer().toString("hex") !== pad(deployment.arc.tokenMessenger.address).slice(2))
    throw new Error("Unsupported Circle source policy.");
  if (!local.mint.equals(accounts.burnTokenMint) || BigInt(local.burnLimitPerMessage.toString()) < amount) throw new Error("Unsupported Circle source policy.");
  const [program, transmitterProgram, denylist, balances] = await Promise.all([
    connection.getAccountInfo(accounts.program, "confirmed"), connection.getAccountInfo(accounts.messageTransmitterProgram, "confirmed"),
    connection.getAccountInfo(accounts.denylistAccount, "confirmed"), readSolanaBalances(connection, deployment, owner),
  ]);
  if (!program?.executable || !transmitterProgram?.executable) throw new Error("Source programs, denylist or native USDC account prevent this burn.");
  if (denylist || !balances.ataPresent || balances.amount < amount) throw new Error("Source programs, denylist or native USDC account prevent this burn.");
  return messenger.minFee;
}

export async function readStandardFee(server: HelperServer) {
  const response = await fetch(`${server.irisApi}/v2/burn/USDC/fees/5/26`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error("Circle fee unavailable.");
  const rows = z.array(z.object({ finalityThreshold: z.number().int(), minimumFee: z.union([z.string(), z.number().finite().nonnegative()]) })).max(20).parse(JSON.parse(await boundedText(response, 16_384)));
  const standard = rows.filter(row => row.finalityThreshold === 2000);
  if (standard.length !== 1) throw new Error("Circle Standard fee unavailable.");
  return standard[0].minimumFee;
}
