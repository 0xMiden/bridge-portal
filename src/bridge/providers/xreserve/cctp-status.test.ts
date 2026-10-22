import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  encodeAbiParameters, encodeEventTopics, encodePacked, pad, parseAbi, parseAbiParameters,
  TransactionReceiptNotFoundError, type Hex,
} from "viem";
import { getCctpStatus } from "./cctp-status";
import { ARC, ARC_MAX_MIDEN_AMOUNT } from "./config";
import { cctpConfig, cctpSource } from "./cctp-config";
import fixture from "./fixtures/cctp-hook.json";

const mocks = vi.hoisted(() => ({
  sourceReceipt: vi.fn(), arcReceipt: vi.fn(), sourceBlock: vi.fn(), arcBlock: vi.fn(), fetch: vi.fn(),
}));
vi.mock("../../evm/rpc.server", () => ({
  evmServerTransport: (network: string) => ({ network }),
}));
vi.mock("viem", async (original) => ({
  ...await original<typeof import("viem")>(),
  createPublicClient: ({ chain, transport }: { chain: { id: number }; transport: { network: string } }) => {
    if (chain.id === 84532) {
      expect(transport.network).toBe("base-sepolia");
      return { getTransactionReceipt: mocks.sourceReceipt, getBlock: mocks.sourceBlock };
    }
    if (chain.id === 5042002) {
      expect(transport.network).toBe("arc-testnet");
      return { getTransactionReceipt: mocks.arcReceipt, getBlock: mocks.arcBlock };
    }
    throw new Error(`Unexpected chain: ${chain.id}`);
  },
}));

const CCTP = cctpConfig();
const source = cctpSource("base-sepolia");
const burnHash: Hex = `0x${"11".repeat(32)}`;
const arcHash: Hex = `0x${"22".repeat(32)}`;
const sourceBlockHash: Hex = `0x${"aa".repeat(32)}`;
const arcBlockHash: Hex = `0x${"bb".repeat(32)}`;
const nonce: Hex = `0x${"33".repeat(32)}`;
const otherAddress: Hex = `0x${"44".repeat(20)}`;
const zero = pad("0x00");
const recipientWord = "0x000000000000000000000000000000004e6fb40fd2f6a55140df2c42dfb5b700";
const faucetWord = "0x000000000000000000000000000000004cbdcaffe75f0a317482224dae643600";
const messageAbi = parseAbi(["event MessageSent(bytes message)"]);
const executionAbi = parseAbi(["event Executed(bytes4 indexed transport,uint8 version,address indexed handler,address indexed token,uint256 amount,bytes32 nonce)"]);
const depositAbi = parseAbi(["event DepositedToRemote(address indexed localToken, uint256 value, address indexed localDepositor, bytes32 indexed remoteRecipient, uint32 remoteDomain, bytes32 remoteToken, uint256 maxFee, bytes hookData)"]);

const messageFields = {
  version: 1, sourceDomain: 6, destinationDomain: 26, nonce: zero,
  sender: pad(CCTP.tokenMessenger), recipient: pad(CCTP.tokenMessenger), destinationCaller: pad(CCTP.executor),
  minFinalityThreshold: 1000, finalityThresholdExecuted: 0,
  burnVersion: 1, burnToken: pad(source.asset.address), mintRecipient: pad(CCTP.executor), amount: 1_000_000n,
  messageSender: pad(CCTP.tokenMessengerWithFees), maxFee: 0n, feeExecuted: 0n, expirationBlock: 0n,
  hook: fixture.hook as Hex,
};
type MessageFields = typeof messageFields;

// Circle's MessageV2 / BurnMessageV2 wire layout and an independently captured
// hook accepted by its quote service. The production decoder is never used here.
function message(overrides: Partial<MessageFields> = {}) {
  const value = { ...messageFields, ...overrides };
  const body = encodePacked(
    ["uint32", "bytes32", "bytes32", "uint256", "bytes32", "uint256", "uint256", "uint256", "bytes"],
    [value.burnVersion, value.burnToken, value.mintRecipient, value.amount, value.messageSender,
      value.maxFee, value.feeExecuted, value.expirationBlock, value.hook],
  );
  return encodePacked(
    ["uint32", "uint32", "uint32", "bytes32", "bytes32", "bytes32", "bytes32", "uint32", "uint32", "bytes"],
    [value.version, value.sourceDomain, value.destinationDomain, value.nonce, value.sender, value.recipient,
      value.destinationCaller, value.minFinalityThreshold, value.finalityThresholdExecuted, body],
  );
}

function sourceReceipt(payload = message()) {
  return {
    status: "success", transactionHash: burnHash, blockHash: sourceBlockHash,
    logs: [{ address: CCTP.messageTransmitter,
      topics: encodeEventTopics({ abi: messageAbi, eventName: "MessageSent" }),
      data: encodeAbiParameters(parseAbiParameters("bytes"), [payload]),
    }],
  };
}

const executionFields = { nonce, version: 1, handler: CCTP.handler, token: ARC.usdc, amount: 1_000_000n };
function executionLog(overrides: Partial<typeof executionFields> = {}) {
  const value = { ...executionFields, ...overrides };
  return {
    address: CCTP.executor,
    topics: encodeEventTopics({ abi: executionAbi, eventName: "Executed",
      args: { transport: "0x43435450", handler: value.handler, token: value.token } }),
    data: encodeAbiParameters(parseAbiParameters("uint8,uint256,bytes32"), [value.version, value.amount, value.nonce]),
  };
}

const depositFields = {
  amount: 1_000_000n, recipient: recipientWord as Hex, faucet: faucetWord as Hex,
  sender: CCTP.handler, domain: 10007, token: ARC.usdc,
};
function depositLog(overrides: Partial<typeof depositFields> = {}) {
  const value = { ...depositFields, ...overrides };
  return {
    address: ARC.xReserve,
    topics: encodeEventTopics({ abi: depositAbi, eventName: "DepositedToRemote",
      args: { localToken: value.token, localDepositor: value.sender, remoteRecipient: value.recipient } }),
    data: encodeAbiParameters(parseAbiParameters("uint256,uint32,bytes32,uint256,bytes"),
      [value.amount, value.domain, value.faucet, 0n, "0x"]),
  };
}

function arcReceipt(logs = [executionLog(), depositLog()]) {
  return { status: "success", transactionHash: arcHash, blockHash: arcBlockHash, logs };
}

function forwardingResponse(overrides: Partial<MessageFields> = {}) {
  return Response.json({ messages: [{
    message: message({ nonce, finalityThresholdExecuted: 1000, ...overrides }), forwardTxHash: arcHash,
  }] });
}

const pendingSource = {
  status: "submitted", forwarding: true, sourceTxAt: 1791483605000,
  source: { sender: fixture.sender, recipient: fixture.recipient, amount: "1000000" },
};
const bindingFailure = { name: "CircleApiError", reason: "binding_mismatch" };
const unsupportedDepositFailure = { name: "UnsupportedArcDepositError" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.sourceReceipt.mockImplementation(async ({ hash }: { hash: Hex }) => {
    expect(hash).toBe(burnHash);
    return sourceReceipt();
  });
  mocks.arcReceipt.mockImplementation(async ({ hash }: { hash: Hex }) => {
    expect(hash).toBe(arcHash);
    return arcReceipt();
  });
  mocks.sourceBlock.mockImplementation(async ({ blockHash }: { blockHash: Hex }) => {
    expect(blockHash).toBe(sourceBlockHash);
    return { timestamp: 1791483605n };
  });
  mocks.arcBlock.mockImplementation(async ({ blockHash }: { blockHash: Hex }) => {
    expect(blockHash).toBe(arcBlockHash);
    return { timestamp: 1791483610n };
  });
  mocks.fetch.mockImplementation(async (url: string) => {
    if (url === `${CCTP.api}/v2/messages/6?transactionHash=${burnHash}`) return forwardingResponse();
    if (url === `${ARC.attestationApi}/v1/attestations?txHash=${arcHash}`) return Response.json({ attestations: [] });
    throw new Error(`Unexpected request: ${url}`);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("binds the burn, Circle nonce, Arc execution and Miden deposit without claiming delivery or rereading the receipt", async () => {
  expect(await getCctpStatus("base-sepolia", burnHash)).toMatchObject({
    ...pendingSource, status: "confirmed", forwarding: false, arcTxHash: arcHash,
    deposit: { amount: "1000000", recipient: fixture.recipient, sender: CCTP.handler.toLowerCase(), faucet: ARC.faucetId },
  });
  expect(mocks.arcReceipt).toHaveBeenCalledTimes(1);
});

it.each([
  ["executed finality", { finalityThresholdExecuted: 2000 }],
  ["expiration block", { expirationBlock: 200_000n }],
] satisfies [string, Partial<MessageFields>][])("accepts Circle's attestation update to %s", async (_, change) => {
  mocks.fetch.mockResolvedValueOnce(forwardingResponse(change));
  expect(await getCctpStatus("base-sepolia", burnHash)).toMatchObject({ status: "confirmed", forwarding: false, arcTxHash: arcHash });
});

it("matches Circle's executed fee update while waiting for the Arc receipt", async () => {
  mocks.sourceReceipt.mockResolvedValueOnce(sourceReceipt(message({ maxFee: 10n })));
  mocks.fetch.mockResolvedValueOnce(forwardingResponse({ maxFee: 10n, feeExecuted: 9n }));
  mocks.arcReceipt.mockRejectedValueOnce(new TransactionReceiptNotFoundError({ hash: arcHash }));
  expect(await getCctpStatus("base-sepolia", burnHash)).toMatchObject(pendingSource);
  expect(mocks.arcReceipt).toHaveBeenCalledWith({ hash: arcHash });
});

it("finds this transfer among unrelated Circle messages before and after it", async () => {
  const unrelated = { message: message({ nonce, hook: "0x" }), forwardTxHash: `0x${"55".repeat(32)}` };
  const matching = { message: message({ nonce, finalityThresholdExecuted: 1000 }), forwardTxHash: arcHash };
  mocks.fetch.mockResolvedValueOnce(Response.json({ messages: [unrelated, matching, unrelated] }));
  expect(await getCctpStatus("base-sepolia", burnHash)).toMatchObject({ status: "confirmed", forwarding: false, arcTxHash: arcHash });
});

it.each([
  ["message version", { version: 2 }],
  ["source domain", { sourceDomain: 0 }],
  ["destination domain", { destinationDomain: 0 }],
  ["sender", { sender: pad(otherAddress) }],
  ["recipient", { recipient: pad(otherAddress) }],
  ["destination caller", { destinationCaller: pad(otherAddress) }],
  ["requested finality", { minFinalityThreshold: 2000 }],
  ["burn version", { burnVersion: 2 }],
  ["burn token", { burnToken: pad(otherAddress) }],
  ["mint recipient", { mintRecipient: pad(otherAddress) }],
  ["amount", { amount: 2_000_000n }],
  ["message sender", { messageSender: pad(otherAddress) }],
  ["maximum fee", { maxFee: 10n }],
  ["hook", { hook: fixture.hook.replace(fixture.sender.slice(2), otherAddress.slice(2)) as Hex }],
] satisfies [string, Partial<MessageFields>][])("does not follow an attestation with a changed %s", async (_, change) => {
  mocks.fetch.mockResolvedValueOnce(forwardingResponse(change));
  expect(await getCctpStatus("base-sepolia", burnHash)).toMatchObject(pendingSource);
  expect(mocks.arcReceipt).not.toHaveBeenCalled();
});

it.each([
  ["version", { version: 2 }, "Unsupported Circle burn message"],
  ["source domain", { sourceDomain: 0 }, "Unsupported Circle burn message"],
  ["destination domain", { destinationDomain: 0 }, "Unsupported Circle burn message"],
  ["sender", { sender: pad(otherAddress) }, "Unsupported Circle burn message"],
  ["destination caller", { destinationCaller: pad(otherAddress) }, "Unsupported Circle burn message"],
  ["burn token", { burnToken: pad(otherAddress) }, "Unsupported Circle burn message"],
  ["mint recipient", { mintRecipient: pad(otherAddress) }, "Unsupported Circle burn message"],
  ["zero amount", { amount: 0n }, "Unsupported burn amount"],
  ["excessive amount", { amount: ARC_MAX_MIDEN_AMOUNT + 1n }, "Unsupported burn amount"],
] satisfies [string, Partial<MessageFields>, string][])("rejects an unsupported source burn %s before trusting Circle", async (_, change, error) => {
  mocks.sourceReceipt.mockResolvedValueOnce(sourceReceipt(message(change)));
  await expect(getCctpStatus("base-sepolia", burnHash)).rejects.toThrow(error);
  expect(mocks.fetch).not.toHaveBeenCalled();
});

it.each([
  ["missing", [], "Expected one Circle burn message"],
  ["ambiguous", [...sourceReceipt().logs, ...sourceReceipt().logs], "Expected one Circle burn message"],
  ["wrong transmitter", [{ ...sourceReceipt().logs[0], address: otherAddress }], "Expected one Circle burn message"],
  ["truncated message", sourceReceipt("0x1234").logs, "Unsupported Circle burn message: missing forwarding hook"],
] satisfies [string, ReturnType<typeof sourceReceipt>["logs"], string][])("rejects %s source messages", async (_, logs, error) => {
  mocks.sourceReceipt.mockResolvedValueOnce({ ...sourceReceipt(), logs });
  await expect(getCctpStatus("base-sepolia", burnHash)).rejects.toThrow(error);
  expect(mocks.fetch).not.toHaveBeenCalled();
});

it.each([
  ["nonce", { nonce: zero }],
  ["version", { version: 2 }],
  ["handler", { handler: otherAddress }],
  ["token", { token: otherAddress }],
  ["amount", { amount: 2_000_000n }],
] satisfies [string, Partial<typeof executionFields>][])("rejects an Arc execution with a different %s", async (_, change) => {
  mocks.arcReceipt.mockResolvedValueOnce(arcReceipt([executionLog(change), depositLog()]));
  await expect(getCctpStatus("base-sepolia", burnHash)).rejects.toMatchObject(bindingFailure);
  expect(mocks.arcBlock).not.toHaveBeenCalled();
});

it.each([
  ["missing execution", [depositLog()]],
  ["wrong executor", [{ ...executionLog(), address: otherAddress }, depositLog()]],
])("rejects an Arc receipt with %s", async (_, logs) => {
  mocks.arcReceipt.mockResolvedValueOnce(arcReceipt(logs));
  await expect(getCctpStatus("base-sepolia", burnHash)).rejects.toMatchObject(bindingFailure);
});

it.each([
  ["amount", { amount: 2_000_000n }, bindingFailure],
  ["recipient", { recipient: faucetWord }, bindingFailure],
  ["sender", { sender: otherAddress }, bindingFailure],
  ["faucet", { faucet: recipientWord }, unsupportedDepositFailure],
  ["domain", { domain: 10008 }, unsupportedDepositFailure],
] satisfies [string, Partial<typeof depositFields>, { name: string; reason?: string }][])("rejects a forwarded Miden deposit with a different %s", async (_, change, error) => {
  mocks.arcReceipt.mockResolvedValueOnce(arcReceipt([executionLog(), depositLog(change)]));
  await expect(getCctpStatus("base-sepolia", burnHash)).rejects.toMatchObject(error);
});

it("reports an unmined source transaction without attempting forwarding", async () => {
  mocks.sourceReceipt.mockRejectedValueOnce(new TransactionReceiptNotFoundError({ hash: burnHash }));
  expect(await getCctpStatus("base-sepolia", burnHash)).toEqual({ status: "submitted" });
  expect(mocks.fetch).not.toHaveBeenCalled();
});

it("reports a reverted source burn without attempting forwarding", async () => {
  mocks.sourceReceipt.mockResolvedValueOnce({ ...sourceReceipt(), status: "reverted" });
  expect(await getCctpStatus("base-sepolia", burnHash)).toEqual({ status: "reverted" });
  expect(mocks.fetch).not.toHaveBeenCalled();
});

it("preserves the verified burn when its block timestamp cannot be read", async () => {
  mocks.sourceBlock.mockRejectedValueOnce(new Error("RPC unavailable"));
  expect(await getCctpStatus("base-sepolia", burnHash)).toEqual({
    status: "submitted", source: pendingSource.source, forwarding: true, warning: expect.any(String),
  });
  expect(mocks.fetch).not.toHaveBeenCalled();
});

it.each([
  ["no messages", { messages: [] }],
  ["pending message bytes", { messages: [{ message: "0x", forwardTxHash: "" }] }],
  ["missing forwarding hash", { messages: [{ message: message({ nonce }) }] }],
  ["empty forwarding hash", { messages: [{ message: message({ nonce }), forwardTxHash: "" }] }],
])("retains a pending burn without a warning for %s", async (_, body) => {
  mocks.fetch.mockResolvedValueOnce(Response.json(body));
  expect(await getCctpStatus("base-sepolia", burnHash)).toEqual(pendingSource);
  expect(mocks.arcReceipt).not.toHaveBeenCalled();
});

it("keeps a verified source burn pending when Circle has not indexed it", async () => {
  mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
  expect(await getCctpStatus("base-sepolia", burnHash)).toEqual(pendingSource);
});

it.each([
  ["network", new TypeError("offline")],
  ["timeout", new DOMException("deadline", "TimeoutError")],
])("retains source recovery details during a Circle %s failure", async (_, error) => {
  mocks.fetch.mockRejectedValueOnce(error);
  expect(await getCctpStatus("base-sepolia", burnHash)).toMatchObject({ ...pendingSource, warning: expect.any(String) });
  expect(mocks.arcReceipt).not.toHaveBeenCalled();
});

it.each([
  ["HTTP failure", () => new Response(null, { status: 503 })],
  ["invalid JSON", () => new Response("not JSON")],
  ["null response", () => Response.json(null)],
  ["missing messages", () => Response.json({})],
  ["null message", () => Response.json({ messages: [null] })],
  ["non-string message", () => Response.json({ messages: [{ message: 7, forwardTxHash: arcHash }] })],
  ["invalid message hex", () => Response.json({ messages: [{ message: "0xzz", forwardTxHash: arcHash }] })],
  ["invalid transaction hash", () => Response.json({ messages: [{ message: message({ nonce }), forwardTxHash: "0x1234" }] })],
])("retains source recovery details and a warning for Circle %s", async (_, response) => {
  mocks.fetch.mockResolvedValueOnce(response());
  expect(await getCctpStatus("base-sepolia", burnHash)).toMatchObject({ ...pendingSource, warning: expect.any(String) });
  expect(mocks.arcReceipt).not.toHaveBeenCalled();
});

it("keeps a verified burn pending while the forwarding receipt is unavailable", async () => {
  mocks.arcReceipt.mockRejectedValueOnce(new TransactionReceiptNotFoundError({ hash: arcHash }));
  expect(await getCctpStatus("base-sepolia", burnHash)).toMatchObject(pendingSource);
});

it("preserves source recovery during an Arc receipt RPC outage", async () => {
  mocks.arcReceipt.mockRejectedValueOnce(new Error("RPC unavailable"));
  expect(await getCctpStatus("base-sepolia", burnHash)).toMatchObject({ ...pendingSource, warning: expect.any(String) });
});

it("rejects a reverted forwarding transaction even if its receipt contains matching logs", async () => {
  mocks.arcReceipt.mockResolvedValueOnce({ ...arcReceipt(), status: "reverted" });
  await expect(getCctpStatus("base-sepolia", burnHash)).rejects.toMatchObject(bindingFailure);
});
