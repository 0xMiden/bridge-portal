import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, keccak256, pad, parseAbiParameters, slice, type Hex, type TransactionReceipt } from "viem";
import { currentBridgeConfig } from "../../../config/bridge-config";
import { helperAbi, helperMessageAbi } from "./helper-abi";
import { xReserveAbi } from "./config";
import { arcRecipient } from "./deposit-terms";
import { validateManualSource } from "../../solana/source-transaction";
import { guardSolanaTransaction } from "../../solana/rpc";
import { deployment, signedFixture } from "./fixtures/manual/test-fixture";
import { validateHelperMessage } from "./helper-attestation.server";
import { decodeCctpMessage } from "./cctp-message";
import { findDepositAttestation } from "./arc-status-server";
import { HELPER_SCAN_BLOCKS, observeHelperCompletion, verifyHelperReceipt, type completionClient } from "./helper-completion.server";

vi.mock("server-only", () => ({}));
const { circle } = vi.hoisted(() => ({ circle: vi.fn() }));
vi.mock("./circle-http.server", () => ({ getCircleJson: circle, reportCircleFailure: vi.fn() }));
const hash = (number: bigint | number): Hex => `0x${BigInt(number).toString(16).padStart(64, "0")}`;
const txHash = hash(900), blockHash = hash(100), reserveNonce = hash(800);
const recovery = currentBridgeConfig("testnet");
const field = (value: Hex, offset: number, width: number, number: number): Hex =>
  `${value.slice(0, 2 + offset * 2)}${number.toString(16).padStart(width * 2, "0")}${value.slice(2 + (offset + width) * 2)}` as Hex;
const uint = (number: string | number | bigint, bytes: number) => BigInt(number).toString(16).padStart(bytes * 2, "0");
function payload(recipient: Hex, nonce = reserveNonce) {
  return `0x5a2e0acd00000001${uint(999990, 32)}${uint(10007, 4)}${arcRecipient(deployment.miden.faucetId).slice(2)}${recipient.slice(2)}${pad(deployment.arc.usdc.address).slice(2)}${pad(deployment.helper.address).slice(2)}${uint(0, 32)}${nonce.slice(2)}00000000` as Hex;
}
async function fixture() {
  const signed = await signedFixture();
  const source = await validateManualSource(guardSolanaTransaction(signed.raw, signed.signature), deployment);
  let message = field(source.message, 12, 32, 1234);
  message = field(message, 144, 4, 2000); message = field(message, 312, 32, 10);
  const decoded = decodeCctpMessage(message);
  const recipient = source.midenRecipient;
  const base = { blockHash, blockNumber: 100n, transactionHash: txHash, transactionIndex: 0, removed: false };
  const logs = [
    { ...base, logIndex: 0, address: deployment.arc.messageTransmitter.address,
      topics: encodeEventTopics({ abi: helperMessageAbi, eventName: "MessageReceived", args: { caller: deployment.helper.address, nonce: decoded.nonce, finalityThresholdExecuted: 2000 } }),
      data: encodeAbiParameters(parseAbiParameters("uint32,bytes32,bytes"), [5, decoded.transfer.sender, slice(message, 148)]) },
    { ...base, logIndex: 1, address: deployment.arc.xReserve.address,
      topics: encodeEventTopics({ abi: xReserveAbi, eventName: "DepositedToRemote", args: { localToken: deployment.arc.usdc.address, localDepositor: deployment.helper.address, remoteRecipient: recipient } }),
      data: encodeAbiParameters(parseAbiParameters("uint256,uint32,bytes32,uint256,bytes"), [999990n, 10007, arcRecipient(deployment.miden.faucetId), 0n, "0x"]) },
    { ...base, logIndex: 2, address: deployment.helper.address,
      topics: encodeEventTopics({ abi: helperAbi, eventName: "DepositedToMiden", args: { sourceDomain: 5, cctpNonce: decoded.nonce, midenRecipient: recipient } }),
      data: encodeAbiParameters(parseAbiParameters("uint256"), [999990n]) },
  ];
  const receipt = { status: "success", transactionHash: txHash, blockHash, blockNumber: 100n, logs,
    from: "0x7777777777777777777777777777777777777777", to: "0x8888888888888888888888888888888888888888" } as unknown as TransactionReceipt;
  const client = { getChainId: vi.fn(async () => 5042002), getCode: vi.fn(async () => "0x60006000"),
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => ({ messageTransmitter: deployment.arc.messageTransmitter.address,
      tokenMessenger: deployment.arc.tokenMessenger.address, usdc: deployment.arc.usdc.address, xReserve: deployment.arc.xReserve.address,
      midenDomain: 10007, expectedMidenFaucet: arcRecipient(deployment.miden.faucetId) })[functionName]),
    getBlock: vi.fn(async ({ blockNumber }: { blockNumber?: bigint }) => ({ number: blockNumber ?? 5000n, hash: hash(blockNumber ?? 5000n) })),
    getLogs: vi.fn(async () => [] as unknown[]), getTransactionReceipt: vi.fn(async () => receipt),
  };
  const input = { message, recipient, netAmount: "999990", recovery };
  circle.mockResolvedValue({ attestations: [{ remoteDomain: 10007, payload: payload(recipient), messageHash: keccak256(payload(recipient)), attestation: "0x12" }] });
  return { source, signed, message, recipient, receipt, client, input };
}
const asClient = (client: Awaited<ReturnType<typeof fixture>>["client"]) => client as unknown as ReturnType<typeof completionClient>;
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("finalized helper/transmitter/reserve receipt binding", () => {
  it("accepts an arbitrary payer/wrapper and separates CCTP nonce1234 from reserve nonce800", async () => {
    const { input, client } = await fixture();
    const completed = await observeHelperCompletion(asClient(client), deployment, { ...input, arcHash: txHash });
    expect(completed).toMatchObject({ stage: "reserve_attested", arc: { transactionHash: txHash, helperLogIndex: 2, messageLogIndex: 0, reserveLogIndex: 1 }, intent: { nonce: reserveNonce, amount: "999990" } });
    expect(decodeCctpMessage(input.message).nonce).not.toBe(completed.intent!.nonce);
    expect(client.getLogs).not.toHaveBeenCalled();
    expect(client.readContract.mock.calls.every(([arg]) => "blockNumber" in arg)).toBe(true);
  });
  it("source/message validation still succeeds after replay simulations would revert", async () => {
    const { source, message } = await fixture();
    expect(validateHelperMessage(source, message, {}).net).toBe(999990n);
  });
  it.each(["reverted", "future", "block-hash", "removed", "helper-address", "helper-nonce", "helper-amount", "transmitter", "caller", "sender", "body", "finality", "reserve-depositor", "reserve-amount", "reserve-fee", "reserve-hook", "reserve-faucet", "reserve-token", "double-deposit"])("rejects %s tuple mutation", async mutation => {
    const { receipt, input, client } = await fixture();
    if (mutation === "reverted") receipt.status = "reverted";
    if (mutation === "future") receipt.blockNumber = 5001n;
    if (mutation === "block-hash") receipt.blockHash = hash(999);
    if (mutation === "removed") receipt.logs[0].removed = true;
    if (mutation === "helper-address") receipt.logs[2].address = deployment.arc.tokenMessenger.address;
    if (mutation === "helper-nonce") receipt.logs[2].topics[2] = hash(7);
    if (mutation === "helper-amount") receipt.logs[2].data = encodeAbiParameters(parseAbiParameters("uint256"), [999991n]);
    if (mutation === "transmitter") receipt.logs[0].address = deployment.arc.tokenMessenger.address;
    if (mutation === "caller") receipt.logs[0].topics[1] = pad(deployment.arc.tokenMessenger.address);
    if (mutation === "finality") receipt.logs[0].topics[3] = hash(1000);
    if (mutation === "sender" || mutation === "body") receipt.logs[0].data = encodeAbiParameters(parseAbiParameters("uint32,bytes32,bytes"), [5,
      mutation === "sender" ? hash(7) : decodeCctpMessage(input.message).transfer.sender, mutation === "body" ? "0x1234" : slice(input.message, 148)]);
    if (mutation === "reserve-depositor") receipt.logs[1].topics[2] = pad(deployment.arc.tokenMessenger.address);
    if (mutation === "reserve-token") receipt.logs[1].topics[1] = pad(deployment.arc.tokenMessenger.address);
    if (["reserve-amount", "reserve-fee", "reserve-hook", "reserve-faucet"].includes(mutation)) receipt.logs[1].data = encodeAbiParameters(parseAbiParameters("uint256,uint32,bytes32,uint256,bytes"), [
      mutation === "reserve-amount" ? 1000000n : 999990n, 10007, mutation === "reserve-faucet" ? input.recipient : arcRecipient(deployment.miden.faucetId), mutation === "reserve-fee" ? 1n : 0n, mutation === "reserve-hook" ? "0x01" : "0x"]);
    if (mutation === "double-deposit") receipt.logs.push({ ...receipt.logs[1], logIndex: 3 });
    await expect(verifyHelperReceipt(asClient(client), receipt, deployment, input, 5000n)).rejects.toThrow();
  });
  it("used nonce or an empty page is never deposit proof", async () => {
    const { client, input } = await fixture();
    const result = await observeHelperCompletion(asClient(client), deployment, input);
    expect(result.stage).toBe("attested"); expect(result.arc).toBeUndefined(); expect(result.intent).toBeUndefined();
  });
  it("a caller's different recovery reserve cannot select an RPC contract or Circle lookup", async () => {
    const { client, input } = await fixture();
    const changed = structuredClone(recovery);
    changed.document.supportedEvmChains["arc-testnet"]!.bridges.usdcx!.deposit = { route: "xreserve", xReserve: deployment.helper.address };
    expect((await observeHelperCompletion(asClient(client), deployment, { ...input, recovery: changed })).arc).toBeUndefined();
    expect(client.getBlock).not.toHaveBeenCalled(); expect(circle).not.toHaveBeenCalled();
  });
  it("deduplicates exact payload bytes and fails closed for differing matching reserve nonces", async () => {
    const { recipient } = await fixture();
    const deposit = { amount: "999990", recipient: `0x${recipient.slice(34, 64)}`, faucet: deployment.miden.faucetId, sender: deployment.helper.address };
    const row = { remoteDomain: 10007, payload: payload(recipient), attestation: "0x12" as Hex };
    expect(findDepositAttestation([row, { ...row }], deposit, recovery).intent?.nonce).toBe(reserveNonce);
    const ambiguous = findDepositAttestation([row, { ...row, payload: payload(recipient, hash(801)) }], deposit, recovery);
    expect(ambiguous).toMatchObject({ warning: expect.stringContaining("multiple matching") });
    expect(ambiguous.candidates).toHaveLength(2); expect(ambiguous.intent).toBeUndefined();
    expect(findDepositAttestation([{ ...row, messageHash: hash(4) }], deposit, recovery).intent).toBeUndefined();
  });
});

describe("finite finalized helper discovery", () => {
  it("reads one exact indexed page, persists the empty checkpoint and resumes after reload", async () => {
    const { client, input } = await fixture();
    const first = await observeHelperCompletion(asClient(client), deployment, input);
    expect(client.getLogs).toHaveBeenCalledTimes(1);
    expect(client.getLogs).toHaveBeenCalledWith(expect.objectContaining({ address: deployment.helper.address, fromBlock: 1n, toBlock: HELPER_SCAN_BLOCKS,
      args: { sourceDomain: 5, cctpNonce: hash(1234), midenRecipient: input.recipient } }));
    expect(first.scan).toEqual({ nextBlock: "2001", checkpoint: { block: "2000", hash: hash(2000) } });
    client.getLogs.mockClear();
    const second = await observeHelperCompletion(asClient(client), deployment, { ...input, scan: JSON.parse(JSON.stringify(first.scan)) });
    expect(client.getLogs).toHaveBeenCalledWith(expect.objectContaining({ fromBlock: 2001n, toBlock: 4000n }));
    expect(second.scan?.nextBlock).toBe("4001"); expect(second.catchingUp).toBe(true);
  });
  it("uses a canonical preburn anchor and resets a corrupt cursor to safe history", async () => {
    const { client, input } = await fixture();
    await observeHelperCompletion(asClient(client), deployment, { ...input, anchor: { block: "4500", hash: hash(4500) } });
    expect(client.getLogs).toHaveBeenLastCalledWith(expect.objectContaining({ fromBlock: 4500n, toBlock: 5000n }));
    await observeHelperCompletion(asClient(client), deployment, { ...input, scan: { nextBlock: "4500", checkpoint: { block: "4499", hash: hash(1) } } });
    expect(client.getLogs).toHaveBeenLastCalledWith(expect.objectContaining({ fromBlock: 1n }));
    client.getBlock.mockImplementation(async ({ blockNumber }) => ({ number: blockNumber === 4500n ? 100n : blockNumber ?? 5000n, hash: hash(blockNumber ?? 5000n) }));
    await observeHelperCompletion(asClient(client), deployment, { ...input, anchor: { block: "4500", hash: hash(4500) } });
    expect(client.getLogs).toHaveBeenLastCalledWith(expect.objectContaining({ fromBlock: 1n }));
  });
  it.each(["timeout", "429", "overfull", "noncanonical", "wrong-hash"])("preserves cursor and source locks on %s", async failure => {
    const { client, input } = await fixture();
    const scan = { nextBlock: "2001", checkpoint: { block: "2000", hash: hash(2000) } };
    if (failure === "timeout" || failure === "429") client.getLogs.mockRejectedValueOnce(new Error(failure));
    if (failure === "overfull") client.getLogs.mockResolvedValueOnce(Array(64).fill({}));
    if (failure === "noncanonical") {
      let checkpoints = 0;
      client.getBlock.mockImplementation(async ({ blockNumber }) => ({ number: blockNumber ?? 5000n,
        hash: hash(blockNumber === 4000n && ++checkpoints > 1 ? 4001n : blockNumber ?? 5000n) }));
    }
    const result = await observeHelperCompletion(asClient(client), deployment, { ...input, scan, ...(failure === "wrong-hash" ? { arcHash: hash(999) } : {}) });
    expect(result.scan).toEqual(scan);
    expect(result.arc).toBeUndefined(); expect(result.stage).toBe("attested");
  });
  it("finds one helper candidate then applies the complete receipt checker", async () => {
    const { client, input } = await fixture();
    client.getLogs.mockResolvedValueOnce([{ blockNumber: 100n, blockHash, transactionHash: txHash, removed: false }]);
    expect((await observeHelperCompletion(asClient(client), deployment, input)).stage).toBe("reserve_attested");
  });
});
