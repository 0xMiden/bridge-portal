import { describe, expect, it, vi } from "vitest";
import { zeroAddress } from "viem";
import { deployment } from "./fixtures/manual/test-fixture";
vi.mock("server-only", () => ({}));
import { assertManualDestinationPolicy } from "./helper-destination-policy.server";

const { arc, helper, miden } = deployment;
const feeRecipient = `0x${"88".repeat(20)}`;
const values: Record<string, unknown> = { feeRecipient, domain: 26, decimals: 6, domainWithdrawalsPaused: false,
  getRemoteDomainDepositor: miden.remoteDomainDepositor, getRemoteDomainHookExecutor: zeroAddress,
  gatewayWallet: arc.gatewayWallet.address, gatewayMinter: arc.gatewayMinter.address, paused: false,
  isTokenSupported: true, allowance: 999_990n, isDenylisted: false, localTokenMessenger: arc.tokenMessenger.address,
  isMinter: true, minterAllowance: 1_000_000n, signatureThreshold: 1n, maxMessageBodySize: 292n, isBlacklisted: false };
type Read = { functionName: string; address: string; args?: readonly unknown[] };
function client(mutate: (read: Read) => unknown = read => values[read.functionName]) {
  return { readContract: vi.fn(async (read: Read) => mutate(read)) } as unknown as Parameters<typeof assertManualDestinationPolicy>[1];
}
const amounts = { grossAmount: 1_000_000n, netAmount: 999_990n, phase: "attested" as const };

describe("configurable fresh destination policy", () => {
  it("checks gross CCTP allowance and authenticated net Gateway allowance separately", async () => {
    await expect(assertManualDestinationPolicy(deployment, client(), amounts)).resolves.toBeUndefined();
    await expect(assertManualDestinationPolicy(deployment, client(), { ...amounts, netAmount: 1_000_000n })).rejects.toThrow();
    await expect(assertManualDestinationPolicy(deployment, client(read => read.functionName === "minterAllowance" ? 999_990n : values[read.functionName]), amounts)).rejects.toThrow();
  });
  it("checks Gateway's actual caller and beneficiary", async () => {
    const rpc = client(); await assertManualDestinationPolicy(deployment, rpc, amounts);
    expect(rpc.readContract).toHaveBeenCalledWith(expect.objectContaining({ address: arc.gatewayWallet.address, functionName: "isDenylisted", args: [arc.xReserve.address] }));
    expect(rpc.readContract).toHaveBeenCalledWith(expect.objectContaining({ address: arc.gatewayWallet.address, functionName: "isDenylisted", args: [miden.remoteDomainDepositor] }));
  });
  it.each(Object.entries({ getRemoteDomainDepositor: helper.address, getRemoteDomainHookExecutor: helper.address,
    gatewayWallet: helper.address, domain: 1, decimals: 18,
    isTokenSupported: false, localTokenMessenger: helper.address, isMinter: false, minterAllowance: 999_999n,
    allowance: 999_989n, signatureThreshold: 0n, feeRecipient: zeroAddress }))
  ("refuses changed %s", async (name, value) => {
    await expect(assertManualDestinationPolicy(deployment, client(read => read.functionName === name ? value : values[read.functionName]), amounts)).rejects.toThrow();
  });
  it.each([arc.gatewayWallet.address])("refuses paused Gateway component %s", async target => {
    await expect(assertManualDestinationPolicy(deployment, client(read => read.functionName === "paused" && read.address === target ? true : values[read.functionName]), amounts)).rejects.toThrow();
  });
  it.each([arc.xReserve.address, miden.remoteDomainDepositor])("refuses denylisted actual principal %s", async target => {
    await expect(assertManualDestinationPolicy(deployment, client(read => read.functionName === "isDenylisted" && read.args?.[0] === target ? true : values[read.functionName]), amounts)).rejects.toThrow();
  });
  it.each([arc.tokenMinter.address, arc.gatewayWallet.address, helper.address, arc.xReserve.address, miden.remoteDomainDepositor, feeRecipient])
  ("refuses native USDC blacklist for %s", async target => {
    await expect(assertManualDestinationPolicy(deployment, client(read => read.functionName === "isBlacklisted" && read.args?.[0] === target ? true : values[read.functionName]), amounts)).rejects.toThrow();
  });
  it.each([
    { name: "domainWithdrawalsPaused", value: true }, { name: "gatewayMinter", value: helper.address },
    { name: "maxMessageBodySize", value: 0n },
  ])("separates conservative new-burn $name policy from incoming recovery", async ({ name, value }) => {
    const rpc = client(read => read.functionName === name ? value : values[read.functionName]);
    await expect(assertManualDestinationPolicy(deployment, rpc, amounts)).resolves.toBeUndefined();
    await expect(assertManualDestinationPolicy(deployment, rpc, { ...amounts, phase: "source-admission" })).rejects.toThrow();
  });
  it("does not depend on GatewayMinter pause for incoming recovery", async () => {
    const rpc = client(read => read.functionName === "paused" && read.address === arc.gatewayMinter.address ? true : values[read.functionName]);
    await expect(assertManualDestinationPolicy(deployment, rpc, amounts)).resolves.toBeUndefined();
    await expect(assertManualDestinationPolicy(deployment, rpc, { ...amounts, phase: "source-admission" })).rejects.toThrow();
  });
  it("does not read or blacklist an unrelated fee recipient for authenticated zero-fee recovery", async () => {
    const rpc = client(read => read.functionName === "allowance" ? 1_000_000n : values[read.functionName]);
    await assertManualDestinationPolicy(deployment, rpc, { ...amounts, netAmount: amounts.grossAmount });
    expect(rpc.readContract).not.toHaveBeenCalledWith(expect.objectContaining({ functionName: "feeRecipient" }));
    expect(rpc.readContract).not.toHaveBeenCalledWith(expect.objectContaining({ functionName: "isBlacklisted", args: [feeRecipient] }));
  });
  it("fails closed when a policy read is unavailable", async () => {
    const rpc = client(); vi.mocked(rpc.readContract).mockRejectedValueOnce(new Error("Unavailable"));
    await expect(assertManualDestinationPolicy(deployment, rpc, amounts)).rejects.toThrow("Unavailable");
  });
});
