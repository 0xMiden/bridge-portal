import "server-only";
import { createPublicClient, getAbiItem, http, keccak256, parseEventLogs, slice, type Hex, type TransactionReceipt } from "viem";
import type { HelperDestination } from "../../../config/cctp-evm-helper";
import type { BridgeConfig } from "../../../config/bridge-config";
import type { HelperServer } from "../../../config/cctp-helper.server";
import { boundedText } from "../../solana/rpc";
import { arcConfig, xReserveAbi } from "./config";
import { decodeCctpMessage } from "./cctp-message";
import { arcRecipient } from "./deposit-terms";
import { helperAbi, helperMessageAbi } from "./helper-abi";
import { getArcDepositAttestation, readDeposit } from "./arc-status-server";
import type { ArcCheckpoint, ArcScan, HelperCompletion } from "./helper-completion-types";

export const HELPER_SCAN_BLOCKS = 2000n;
const MAX_LOGS = 64;
const MAX_RECEIPT_LOGS = 256;
const depositedEvent = getAbiItem({ abi: helperAbi, name: "DepositedToMiden" });

/** Every observation has one finite page and a shared wall-clock/body budget. */
export function completionClient(server: Pick<HelperServer, "arcRpc">) {
  const signal = AbortSignal.timeout(20_000);
  return createPublicClient({ transport: http(server.arcRpc, { retryCount: 0, timeout: 10_000,
    fetchOptions: { signal }, fetchFn: async (input, init) => {
      const response = await fetch(input, { ...init, signal, redirect: "error" });
      const body = await boundedText(response, 1_000_000);
      return new Response(body, { status: response.status, headers: response.headers });
    },
  }) });
}
type Client = ReturnType<typeof completionClient>;
export type CompletionInput = { message: Hex; recipient: Hex; netAmount: string; recovery: BridgeConfig;
  anchor?: ArcCheckpoint; scan?: ArcScan; arcHash?: Hex };

/** Bind the two adapters before using the shared xReserve parser or note owner. */
export function assertCompletionConfig(deployment: HelperDestination, recovery: BridgeConfig) {
  const arc = arcConfig(recovery);
  const matchesNetwork = deployment.environment === recovery.environment && deployment.arc.chainId === arc.chainId;
  const matchesReserve = deployment.arc.usdc.address === arc.usdc.toLowerCase() && deployment.arc.xReserve.address === arc.xReserve.toLowerCase();
  const matchesMiden = deployment.miden.domain === arc.midenDomain && deployment.miden.faucetId === arc.faucetId;
  if (!matchesNetwork || !matchesReserve || !matchesMiden) throw new Error("Historical helper and reserve configuration disagree.");
}

async function assertHistoricalIdentity(client: Client, deployment: HelperDestination, blockNumber: bigint) {
  if (await client.getChainId() !== deployment.arc.chainId) throw new Error("Wrong Arc chain.");
  const code = await client.getCode({ address: deployment.helper.address, blockNumber });
  if (!code || keccak256(code) !== deployment.helper.runtimeHash) throw new Error("Historical helper runtime mismatch.");
  const names = ["messageTransmitter", "tokenMessenger", "usdc", "xReserve", "midenDomain", "expectedMidenFaucet"] as const;
  const actual = await Promise.all(names.map(functionName => client.readContract({ address: deployment.helper.address, abi: helperAbi, functionName, blockNumber })));
  const expected = [deployment.arc.messageTransmitter.address, deployment.arc.tokenMessenger.address,
    deployment.arc.usdc.address, deployment.arc.xReserve.address, deployment.miden.domain, arcRecipient(deployment.miden.faucetId)];
  if (actual.some((value, index) => String(value).toLowerCase() !== String(expected[index]).toLowerCase())) throw new Error("Historical helper immutable mismatch.");
}

async function assertCanonicalReceipt(client: Pick<Client, "getBlock">, receipt: TransactionReceipt, deployment: HelperDestination, finalized: bigint) {
  if (receipt.status !== "success" || receipt.blockNumber > finalized) throw new Error("Arc receipt is not a finalized success.");
  if (receipt.blockNumber < BigInt(deployment.helper.deploymentBlock) || receipt.logs.length > MAX_RECEIPT_LOGS)
    throw new Error("Unsupported Arc receipt.");
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  if (block.hash !== receipt.blockHash || block.number !== receipt.blockNumber) throw new Error("Arc receipt is not canonical.");
  if (receipt.logs.some(log => log.removed || log.blockHash !== receipt.blockHash || log.transactionHash !== receipt.transactionHash))
    throw new Error("Inconsistent Arc receipt logs.");
  if (receipt.logs.some(log => log.blockNumber !== receipt.blockNumber || !Number.isSafeInteger(log.logIndex) || log.logIndex < 0))
    throw new Error("Invalid Arc log coordinates.");
}

function readHelperEvent(receipt: TransactionReceipt, deployment: HelperDestination, input: CompletionInput) {
  const message = decodeCctpMessage(input.message);
  const events = parseEventLogs({ abi: helperAbi, eventName: "DepositedToMiden", strict: true,
    logs: receipt.logs.filter(log => log.address.toLowerCase() === deployment.helper.address) });
  if (events.length !== 1) throw new Error("Ambiguous helper execution.");
  const event = events[0], args = event.args;
  if (args.sourceDomain !== message.transfer.sourceDomain || args.cctpNonce !== message.nonce) throw new Error("Helper source/nonce mismatch.");
  if (args.midenRecipient !== input.recipient || args.amount.toString() !== input.netAmount) throw new Error("Helper recipient/principal mismatch.");
  return event;
}

function readAuthenticatedReceive(receipt: TransactionReceipt, deployment: HelperDestination, input: CompletionInput) {
  const message = decodeCctpMessage(input.message);
  const received = parseEventLogs({ abi: helperMessageAbi, eventName: "MessageReceived", strict: true,
    logs: receipt.logs.filter(log => log.address.toLowerCase() === deployment.arc.messageTransmitter.address) });
  if (received.length !== 1) throw new Error("Ambiguous authenticated CCTP receive.");
  const event = received[0], args = event.args;
  if (args.caller.toLowerCase() !== deployment.helper.address || args.sourceDomain !== message.transfer.sourceDomain || args.nonce !== message.nonce)
    throw new Error("CCTP caller/source/nonce mismatch.");
  if (args.sender !== message.transfer.sender || args.finalityThresholdExecuted !== message.finalityThresholdExecuted)
    throw new Error("CCTP sender/finality mismatch.");
  if (args.messageBody !== slice(input.message, 148)) throw new Error("CCTP receive does not authenticate these message bytes.");
  return event;
}

function readHelperReserve(receipt: TransactionReceipt, deployment: HelperDestination, input: CompletionInput) {
  const deposit = readDeposit(receipt, input.recovery);
  if (deposit.sender !== deployment.helper.address || deposit.amount !== input.netAmount || arcRecipient(deposit.recipient) !== input.recipient)
    throw new Error("Reserve deposit does not match helper execution.");
  const events = parseEventLogs({ abi: xReserveAbi, eventName: "DepositedToRemote", strict: true,
    logs: receipt.logs.filter(log => log.address.toLowerCase() === deployment.arc.xReserve.address) })
    .filter(log => log.args.remoteDomain === deployment.miden.domain && log.args.localToken.toLowerCase() === deployment.arc.usdc.address);
  if (events.length !== 1) throw new Error("Ambiguous reserve deposit.");
  return { deposit, logIndex: events[0].logIndex };
}

/** The payer and top-level call are irrelevant: these three authenticated events bind completion. */
export async function verifyHelperReceipt(client: Pick<Client, "getBlock">, receipt: TransactionReceipt,
  deployment: HelperDestination, input: CompletionInput, finalized: bigint) {
  assertCompletionConfig(deployment, input.recovery);
  await assertCanonicalReceipt(client, receipt, deployment, finalized);
  const helper = readHelperEvent(receipt, deployment, input);
  const message = readAuthenticatedReceive(receipt, deployment, input);
  const reserve = readHelperReserve(receipt, deployment, input);
  return { deposit: reserve.deposit, arc: { transactionHash: receipt.transactionHash, block: receipt.blockNumber.toString(), blockHash: receipt.blockHash,
    helperLogIndex: helper.logIndex, messageLogIndex: message.logIndex, reserveLogIndex: reserve.logIndex } };
}

async function validatedStart(client: Client, checkpoint: ArcCheckpoint, next: bigint, floor: bigint, head: bigint) {
  const number = BigInt(checkpoint.block);
  if (number < floor || number > head) return;
  if (next < floor || next > head + 1n || next > number + 1n) return;
  const block = await client.getBlock({ blockNumber: number });
  return block.number === number && block.hash === checkpoint.hash ? next : undefined;
}

async function initialBlock(client: Client, deployment: HelperDestination, input: CompletionInput, head: bigint) {
  const floor = BigInt(deployment.helper.deploymentBlock);
  // A cursor saves work; it never establishes completion or releases a source lock.
  if (input.scan) {
    const next = await validatedStart(client, input.scan.checkpoint, BigInt(input.scan.nextBlock), floor, head);
    if (next !== undefined) return next;
  }
  if (input.anchor) {
    const anchor = await validatedStart(client, input.anchor, BigInt(input.anchor.block), floor, head);
    if (anchor !== undefined) return anchor;
  }
  return floor;
}

type Page = { hash?: Hex; scan?: ArcScan; catchingUp: boolean; ambiguous?: boolean };
async function emptyPageCheckpoint(client: Client, toBlock: bigint): Promise<ArcScan> {
  const block = await client.getBlock({ blockNumber: toBlock });
  if (!block.hash || block.number !== toBlock) throw new Error("Arc checkpoint unavailable.");
  const check = await client.getBlock({ blockNumber: toBlock });
  if (check.hash !== block.hash) throw new Error("Arc checkpoint changed.");
  return { nextBlock: (toBlock + 1n).toString(), checkpoint: { block: toBlock.toString(), hash: block.hash } };
}

async function readPage(client: Client, deployment: HelperDestination, input: CompletionInput, head: bigint): Promise<Page> {
  const fromBlock = await initialBlock(client, deployment, input, head);
  const toBlock = fromBlock + HELPER_SCAN_BLOCKS - 1n < head ? fromBlock + HELPER_SCAN_BLOCKS - 1n : head;
  if (fromBlock > head) return { scan: input.scan, catchingUp: false };
  const message = decodeCctpMessage(input.message);
  const logs = await client.getLogs({ address: deployment.helper.address, event: depositedEvent,
    args: { sourceDomain: message.transfer.sourceDomain, cctpNonce: message.nonce, midenRecipient: input.recipient }, fromBlock, toBlock, strict: true });
  if (logs.length >= MAX_LOGS) throw new Error("Arc page is too large to establish complete history.");
  for (const log of logs) {
    if (log.removed || log.blockNumber === null || !log.blockHash) throw new Error("Arc page is incomplete.");
    if (log.blockNumber < fromBlock || log.blockNumber > toBlock || !log.transactionHash) throw new Error("Arc page is inconsistent.");
  }
  if (logs.length > 1) return { scan: input.scan, catchingUp: true, ambiguous: true };
  if (logs.length === 1) return { hash: logs[0].transactionHash, scan: input.scan, catchingUp: false };
  return { scan: await emptyPageCheckpoint(client, toBlock), catchingUp: toBlock < head };
}

async function readCompletion(client: Client, deployment: HelperDestination, input: CompletionInput, head: bigint, page: Page): Promise<HelperCompletion> {
  if (!page.hash) return { schemaVersion: 1, stage: "attested", scan: page.scan, catchingUp: page.catchingUp,
    ...(page.ambiguous ? { needsAttention: true, warning: "Multiple helper executions need review." } : {}) };
  const receipt = await client.getTransactionReceipt({ hash: page.hash });
  if (receipt.transactionHash !== page.hash) throw new Error("Arc locator returned a different transaction.");
  const verified = await verifyHelperReceipt(client, receipt, deployment, input, head);
  const attested = await getArcDepositAttestation(page.hash, verified.deposit, input.recovery);
  const result: HelperCompletion = { schemaVersion: 1, stage: "arc_deposited", catchingUp: false, scan: page.scan,
    arc: verified.arc, warning: attested.warning, candidates: attested.candidates,
    needsAttention: attested.warning?.includes("multiple matching") || undefined };
  const intent = attested.intent;
  if (intent?.payload && intent.messageHash) {
    result.stage = "reserve_attested";
    result.intent = { ...intent, payload: intent.payload as Hex, messageHash: intent.messageHash as Hex, sender: intent.sender as Hex, nonce: intent.nonce as Hex };
  }
  return result;
}

export async function observeHelperCompletion(client: Client, deployment: HelperDestination, input: CompletionInput): Promise<HelperCompletion> {
  try {
    assertCompletionConfig(deployment, input.recovery);
    const head = await client.getBlock({ blockTag: "finalized" });
    if (head.number === null || head.hash === null) throw new Error("Finalized Arc history is unavailable.");
    if (head.number < BigInt(deployment.helper.deploymentBlock)) throw new Error("Finalized helper history is unavailable.");
    await assertHistoricalIdentity(client, deployment, head.number);
    const page = input.arcHash ? { hash: input.arcHash, scan: input.scan, catchingUp: false }
      : await readPage(client, deployment, input, head.number);
    return await readCompletion(client, deployment, input, head.number, page);
  } catch {
    return { schemaVersion: 1, stage: "attested", catchingUp: true, scan: input.scan,
      warning: "Arc completion could not be verified. Saved progress and source locks are retained; tracking will retry." };
  }
}
