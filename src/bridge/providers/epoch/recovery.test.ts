import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, encodeFunctionResult, http, zeroAddress } from "viem";
import { createLockTag, getAllocatorId, getTokenId } from "@epoch-protocol/epoch-intents-sdk/dist/helpers/chains";
import { assetKey, type EvmAsset } from "../../core/assets";
import { readLockedDeposit, recoveryAbi, recoveryAssets, recoveryLockId, withdrawalReady } from "./recovery";

const sponsor = "0x1111111111111111111111111111111111111111";
const native: EvmAsset = { kind: "native", symbol: "ETH", decimals: 18, network: "ethereum" };

vi.mock("../../evm/transport", () => ({ evmReadTransport: () => http("https://rpc.test", { retryCount: 0 }) }));

afterEach(() => vi.unstubAllGlobals());

describe("Compact recovery", () => {
  it.each([
    { environment: "mainnet", allocator: "0xC7a2E29b7ef4543a3e7c50057d83beDfCdE2fb0C" },
    { environment: "testnet", allocator: "0xa46827635A7d329608085401a3b2Bf14a8a2bDF9" },
  ] satisfies { environment: "mainnet" | "testnet"; allocator: string }[])("matches SDK lock IDs on $environment", ({ environment, allocator }) => {
    for (const asset of [...recoveryAssets(environment), native]) {
      const token = asset.kind === "native" ? zeroAddress : asset.address;
      const tag = createLockTag(4n, 0n, getAllocatorId(BigInt(allocator)));
      expect(recoveryLockId(asset, environment)).toBe(getTokenId(tag, BigInt(token)));
    }
  });

  it("scans all mainnet Fast chains and does not repeat tokens", () => {
    const assets = recoveryAssets("mainnet");
    expect(new Set(assets.map(asset => asset.network))).toEqual(new Set(["ethereum", "base", "arbitrum", "polygon", "robinhood"]));
    expect(new Set(assets.map(assetKey)).size).toBe(assets.length);
  });

  it("reads balances and withdrawal deadlines from the contract without allocator access", async () => {
    const balance = 12345678901234567890n;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const body = await new Request(input, init).json();
      const call = decodeFunctionData({ abi: recoveryAbi, data: body.params[0].data });
      expect(call.args).toEqual([sponsor, recoveryLockId(native, "mainnet")]);
      const result = call.functionName === "balanceOf"
        ? encodeFunctionResult({ abi: recoveryAbi, functionName: "balanceOf", result: balance })
        : encodeFunctionResult({ abi: recoveryAbi, functionName: "getForcedWithdrawalStatus", result: [1, 12345n] });
      return Response.json({ jsonrpc: "2.0", id: body.id, result });
    }));
    expect(await readLockedDeposit(native, "mainnet", sponsor)).toEqual({
      asset: native, id: recoveryLockId(native, "mainnet"), balance, status: 1, withdrawableAt: 12345n,
    });
  });

  it("preserves failed reads as errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "RPC unavailable" }, { status: 502 })));
    await expect(readLockedDeposit(native, "mainnet", sponsor)).rejects.toThrow();
  });

  it("uses the contract deadline when Pending becomes due", () => {
    const pending = { status: 1, withdrawableAt: 5000n };
    expect(withdrawalReady(pending, 4999)).toBe(false);
    expect(withdrawalReady(pending, 5000)).toBe(true);
    expect(withdrawalReady({ status: 0, withdrawableAt: 0n }, 5000)).toBe(false);
  });
});
