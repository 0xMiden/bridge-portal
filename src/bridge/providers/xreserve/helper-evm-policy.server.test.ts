import { beforeEach, describe, expect, it, vi } from "vitest";
import { pad } from "viem";
import { assertEvmSourcePolicy, evmStandardFee } from "./helper-evm-policy.server";
import { evmDeployment, code, sender } from "./fixtures/evm/test-fixture";
vi.mock("server-only", () => ({}));
const { rpc } = vi.hoisted(() => ({ rpc: { getChainId: vi.fn(), getCode: vi.fn(), getStorageAt: vi.fn(), getBlock: vi.fn(), readContract: vi.fn(), getBalance: vi.fn() } }));
vi.mock("viem", async original => ({ ...await original<typeof import("viem")>(), createPublicClient: () => rpc }));
const server = { deploymentId: "evm-sepolia-test", sourceRpc: "https://source.invalid", arcRpc: "https://arc.invalid", irisApi: "https://iris-api-sandbox.circle.com", simulationCaller: "0x8888888888888888888888888888888888888888" as const };
beforeEach(() => {
  vi.clearAllMocks(); rpc.getChainId.mockResolvedValue(11155111); rpc.getCode.mockImplementation(async ({ address }) => address === sender ? undefined : code);
  rpc.getStorageAt.mockResolvedValue(pad(evmDeployment.source.tokenMessenger.implementation.address)); rpc.getBlock.mockResolvedValue({ number: 100n }); rpc.getBalance.mockResolvedValue(10n ** 18n);
  rpc.readContract.mockImplementation(async ({ functionName }) => ({ paused: false, isBlacklisted: false, balanceOf: 1000000n, localDomain: 0,
    version: 1, maxMessageBodySize: 292n, messageBodyVersion: 1, localMessageTransmitter: evmDeployment.source.messageTransmitter.address,
    localMinter: evmDeployment.source.tokenMinter.address, remoteTokenMessengers: pad(evmDeployment.arc.tokenMessenger.address),
    localTokenMessenger: evmDeployment.source.tokenMessenger.address, burnLimitsPerMessage: 1000000n, getMinFeeAmount: 25n, isDenylisted: false }[functionName as string]));
});
describe("native source fee, mutable policy and proxy identity", () => {
  it("qualifies legacy zero Standard without calling nonexistent fee getter, while always checking denylist", async () => {
    await expect(assertEvmSourcePolicy(evmDeployment, server, sender, 1000000n)).resolves.toBe(0n);
    expect(rpc.readContract).not.toHaveBeenCalledWith(expect.objectContaining({ functionName: "getMinFeeAmount" }));
    expect(rpc.readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "isDenylisted", args: [sender] }));
  });
  it("uses verified fee-switch getter and never falls back to zero on RPC/revert", async () => {
    const d = { ...evmDeployment, source: { ...evmDeployment.source, feePolicy: "fee-switch" as const } };
    await expect(assertEvmSourcePolicy(d, server, sender, 1000000n)).resolves.toBe(25n);
    rpc.readContract.mockImplementation(async () => { throw new Error("fee source outage"); });
    await expect(assertEvmSourcePolicy(d, server, sender, 1000000n)).rejects.toThrow();
  });
  it.each(["proxy-implementation", "implementation-runtime", "native-zero", "unsupported-finality", "denylisted", "burn-cap"])("rejects %s before wallet", async mutation => {
    if (mutation === "proxy-implementation") rpc.getStorageAt.mockResolvedValue(pad(sender));
    if (mutation === "implementation-runtime") rpc.getCode.mockResolvedValue("0x6001");
    if (mutation === "native-zero") rpc.getBalance.mockResolvedValue(0n);
    if (mutation === "unsupported-finality") rpc.getBlock.mockRejectedValue(new Error("unsupported"));
    if (mutation === "denylisted") rpc.readContract.mockResolvedValue(true);
    if (mutation === "burn-cap") rpc.readContract.mockResolvedValue(0n);
    await expect(assertEvmSourcePolicy(evmDeployment, server, sender, 1000000n)).rejects.toThrow();
  });
  it("rounds Iris decimal basis points upwards and uses the larger exact onchain minimum", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([{ finalityThreshold: 2000, minimumFee: "0.000001" }])));
    await expect(evmStandardFee(evmDeployment, server, 1000000n, 0n)).resolves.toBe(1n);
    await expect(evmStandardFee(evmDeployment, server, 1000000n, 25n)).resolves.toBe(25n);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/0/26"), expect.objectContaining({ redirect: "error" }));
  });
});
