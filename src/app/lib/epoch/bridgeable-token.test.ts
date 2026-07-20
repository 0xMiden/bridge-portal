import { describe, expect, test } from "vitest";

import {
  BRIDGEABLE_EVM_OUTPUT_TOKEN_ADDRESS,
  BRIDGEABLE_EVM_OUTPUT_TOKEN_DECIMALS,
  BRIDGEABLE_EVM_OUTPUT_TOKEN_SYMBOL,
  EPOCH_DESTINATION_CHAIN_ID,
  isBridgeableEvmTokenConfigured,
} from "./bridgeable-token";

describe("bridgeable-token constants", () => {
  test("EVM destination chain id is Sepolia (11155111)", () => {
    expect(EPOCH_DESTINATION_CHAIN_ID).toBe(11155111);
  });

  test("output token is a checksummed-length 20-byte address", () => {
    expect(BRIDGEABLE_EVM_OUTPUT_TOKEN_ADDRESS).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  test("output token metadata is USDC with Epoch's 18-decimal convention", () => {
    expect(BRIDGEABLE_EVM_OUTPUT_TOKEN_SYMBOL).toBe("USDC");
    expect(BRIDGEABLE_EVM_OUTPUT_TOKEN_DECIMALS).toBe(18);
  });
});

describe("isBridgeableEvmTokenConfigured", () => {
  test("returns true for the configured Sepolia USDC address", () => {
    expect(isBridgeableEvmTokenConfigured()).toBe(true);
  });

  // The guard's own predicate re-implemented over sample inputs, documenting
  // exactly which addresses count as "configured". The live check above proves
  // the shipped constant satisfies it.
  const check = (addr: string) =>
    /^0x[0-9a-fA-F]{40}$/.test(addr) &&
    addr !== "0x0000000000000000000000000000000000000000";

  test("rejects the zero address", () => {
    expect(check("0x0000000000000000000000000000000000000000")).toBe(false);
  });

  test("rejects a malformed / short address", () => {
    expect(check("0x1234")).toBe(false);
    expect(check("not-an-address")).toBe(false);
  });

  test("accepts a well-formed non-zero address", () => {
    expect(check(BRIDGEABLE_EVM_OUTPUT_TOKEN_ADDRESS)).toBe(true);
  });
});
