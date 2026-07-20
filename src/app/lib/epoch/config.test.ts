import { describe, expect, test } from "vitest";

import {
  EPOCH_ALLOCATOR_URL,
  MIDEN_DESTINATION_CHAIN_ID,
  MIDEN_MIN_RECLAIM_BLOCKS,
  MIDEN_NATIVE_FAUCET_ID,
  MIDEN_NATIVE_TOKEN_DECIMALS,
  MIDEN_NATIVE_TOKEN_SYMBOL,
} from "./config";

// These constants are the ones the issue calls out explicitly: a stale faucet
// id or a silent v-bump (decimals / chain id / reclaim window drift) breaks the
// live route with no compile error. Pinning them here turns such a regression
// into a red CI run. Update deliberately, in lockstep with the source change.

describe("epoch config constants", () => {
  test("allocator URL falls back to the testnet-dev endpoint when unset", () => {
    // No NEXT_PUBLIC_EPOCH_ALLOCATOR_URL in the test env, so the default holds.
    expect(EPOCH_ALLOCATOR_URL).toBe("https://testnet-dev.epochprotocol.xyz");
  });

  test("Miden virtual destination chain id is 999999999", () => {
    expect(MIDEN_DESTINATION_CHAIN_ID).toBe(999999999);
  });

  test("minimum reclaim window is 1000 Miden blocks", () => {
    expect(MIDEN_MIN_RECLAIM_BLOCKS).toBe(1000);
  });

  test("Miden-side USDC faucet id matches Epoch's documented USDC faucet", () => {
    // Guards the exact regression named in the issue (a stale faucet id). This
    // is the USDC faucet, NOT the MIDEN token faucet 0x2458e5...9ce1.
    expect(MIDEN_NATIVE_FAUCET_ID).toBe("0xfc90f0f4da30e51168453b60eafed7");
  });

  test("Miden-side token metadata is USDC with 6 decimals", () => {
    expect(MIDEN_NATIVE_TOKEN_SYMBOL).toBe("USDC");
    expect(MIDEN_NATIVE_TOKEN_DECIMALS).toBe(6);
  });

  test("faucet id is a valid 0x hex string", () => {
    expect(MIDEN_NATIVE_FAUCET_ID).toMatch(/^0x[0-9a-fA-F]+$/);
  });
});
