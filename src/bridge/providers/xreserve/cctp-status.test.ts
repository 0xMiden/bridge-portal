import { beforeEach, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, encodePacked, pad, parseAbi, parseAbiParameters, type Hex } from "viem";
import { getCctpStatus } from "./cctp-status";
import { ARC } from "./config";
import { CCTP, cctpSources } from "./cctp-config";
import fixture from "./fixtures/cctp-hook.json";

const mocks = vi.hoisted(() => ({ receipt: vi.fn(), arcReceipt: vi.fn(), arcStatus: vi.fn(), fetch: vi.fn() }));
vi.mock("viem", async (original) => ({ ...await original<typeof import("viem")>(),
  createPublicClient: ({ chain }: { chain: { id: number } }) => ({
    getTransactionReceipt: chain.id === 5042002 ? mocks.arcReceipt : mocks.receipt,
    getBlock: async () => ({ timestamp: 1791483605n }),
  }),
}));
vi.mock("./arc-status-server", () => ({ getArcDepositStatus: mocks.arcStatus }));
const burnHash = `0x${"11".repeat(32)}` as Hex;
const arcHash = `0x${"22".repeat(32)}` as Hex;
const nonce = `0x${"33".repeat(32)}` as Hex;
const zero = pad("0x00");
const source = cctpSources["base-sepolia"];

// Circle's documented MessageV2 / BurnMessageV2 layout, with the independently
// captured hook that its quote service accepted. No production encoder here.
function message(attested: boolean, hook = fixture.hook as Hex) {
  const body = encodePacked(["uint32", "bytes32", "bytes32", "uint256", "bytes32", "uint256", "uint256", "uint256", "bytes"],
    [1, pad(source.asset.address), pad(CCTP.executor), 1000000n, pad(CCTP.tokenMessengerWithFees), 0n, 0n, 0n, hook]);
  return encodePacked(["uint32", "uint32", "uint32", "bytes32", "bytes32", "bytes32", "bytes32", "uint32", "uint32", "bytes"],
    [1, 6, 26, attested ? nonce : zero, pad(CCTP.tokenMessenger), pad(CCTP.tokenMessenger), pad(CCTP.executor), 1000, attested ? 1000 : 0, body]);
}
function sourceReceipt(hook?: Hex) {
  return { status: "success", blockHash: burnHash, logs: [{ address: CCTP.messageTransmitter,
    topics: encodeEventTopics({ abi: parseAbi(["event MessageSent(bytes message)"]), eventName: "MessageSent" }),
    data: encodeAbiParameters(parseAbiParameters("bytes"), [message(false, hook)]),
  }] };
}
function forwardedReceipt(eventNonce = nonce) {
  return { status: "success", logs: [{ address: CCTP.executor,
    topics: encodeEventTopics({ abi: parseAbi(["event Executed(bytes4 indexed transport,uint8 version,address indexed handler,address indexed token,uint256 amount,bytes32 nonce)"]),
      eventName: "Executed", args: { transport: "0x43435450", handler: CCTP.handler, token: ARC.usdc } }),
    data: encodeAbiParameters(parseAbiParameters("uint8,uint256,bytes32"), [1, 1000000n, eventNonce]),
  }] };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.receipt.mockResolvedValue(sourceReceipt());
  mocks.arcReceipt.mockResolvedValue(forwardedReceipt());
  mocks.fetch.mockImplementation(async () => Response.json({ messages: [{ message: message(true), forwardTxHash: arcHash }] }));
  mocks.arcStatus.mockImplementation(async () => Response.json({ status: "confirmed", deposit: {
    amount: "1000000", recipient: fixture.recipient, sender: CCTP.handler, faucet: ARC.faucetId,
  } }));
});

it("correlates the original burn, Circle nonce, Arc execution and Miden deposit without claiming delivery", async () => {
  expect(await getCctpStatus("base-sepolia", burnHash)).toMatchObject({ status: "confirmed", arcTxHash: arcHash,
    sourceTxAt: 1791483605000, source: { sender: fixture.sender, recipient: fixture.recipient, amount: "1000000" }, forwarding: false });
});
it("keeps the burn pending while Circle has no forwarding transaction", async () => {
  mocks.fetch.mockImplementation(async () => Response.json({ messages: [] }));
  expect(await getCctpStatus("base-sepolia", burnHash)).toMatchObject({ status: "submitted", forwarding: true });
  expect(mocks.arcStatus).not.toHaveBeenCalled();
});
it("rejects an Arc transaction for a different Circle nonce", async () => {
  mocks.arcReceipt.mockResolvedValue(forwardedReceipt(zero));
  await expect(getCctpStatus("base-sepolia", burnHash)).rejects.toThrow("does not match the source transfer");
  expect(mocks.arcStatus).not.toHaveBeenCalled();
});
it("does not follow an attested message whose hook differs from the on-chain burn", async () => {
  const changed = fixture.hook.replace(fixture.sender.slice(2), "44".repeat(20)) as Hex;
  mocks.fetch.mockImplementation(async () => Response.json({ messages: [{ message: message(true, changed), forwardTxHash: arcHash }] }));
  expect(await getCctpStatus("base-sepolia", burnHash)).toMatchObject({ status: "submitted", forwarding: true });
  expect(mocks.arcReceipt).not.toHaveBeenCalled();
});
it("rejects a burn from a different source domain", async () => {
  await expect(getCctpStatus("sepolia", burnHash)).rejects.toThrow("Unsupported Circle burn message");
});
