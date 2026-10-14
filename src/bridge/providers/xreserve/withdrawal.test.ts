import { describe, expect, it } from "vitest";
import { validateWithdrawal, withdrawalPayload } from "./withdrawal";

describe("USDCx withdrawal terms", () => {
  it("encodes the protocol's padded recipient as little-endian u32 limbs", () => {
    expect(withdrawalPayload("0x1122334455667788990011223344556677889900", 26)).toEqual([
      26n, 0n, 0n, 0n, 0n, 0n, 0n,
      0x44332211n, 0x88776655n, 0x22110099n, 0x66554433n, 0x00998877n,
    ]);
  });
  it.each(["0x0000000000000000000000000000000000000000", "invalid"])("rejects an unpayable recipient %s", address => {
    expect(() => withdrawalPayload(address, 26)).toThrow(/valid address/);
  });
  it.each([NaN, -1, 10007, 26.5])("rejects unsupported domain %s", domain => {
    expect(() => withdrawalPayload("0x1122334455667788990011223344556677889900", domain)).toThrow(/supported/);
  });
  it.each(["0", "0.999999", "1.0000001", "1e6"])("refuses invalid or below-minimum amount %s", amount => {
    expect(() => validateWithdrawal(amount, "arc-testnet")).toThrow();
  });
  it("keeps exact base units and rejects a Sepolia withdrawal swallowed by the fee allowance", () => {
    expect(validateWithdrawal("1.000001", "arc-testnet")).toBe(1_000_001n);
    expect(() => validateWithdrawal("1.5", "sepolia")).toThrow(/more than 1.5/);
    expect(validateWithdrawal("1.500001", "sepolia")).toBe(1_500_001n);
  });
});
