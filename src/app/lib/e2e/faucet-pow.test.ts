import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { faucetMintAmount, hexToBytes, parseAccountSeed, sha256, solveFaucetPow } from "./faucet-pow";

describe("sha256", () => {
  it("matches Node for a short message and an empty one", () => {
    for (const message of ["", "abc", "faucet-pow"]) {
      const bytes = new TextEncoder().encode(message);
      const ours = Buffer.from(sha256(bytes)).toString("hex");
      const node = createHash("sha256").update(bytes).digest("hex");
      expect(ours).toBe(node);
    }
  });
});

describe("parseAccountSeed", () => {
  it("accepts a 32-byte hex seed with or without 0x", () => {
    const hex = "11".repeat(32);
    expect(parseAccountSeed(hex)).toEqual(parseAccountSeed(`0x${hex}`));
    expect(parseAccountSeed(hex)).toHaveLength(32);
  });

  it("rejects a seed that is not 32 bytes", () => {
    expect(() => parseAccountSeed("abcd")).toThrow(/32 bytes/);
  });
});

describe("solveFaucetPow", () => {
  it("returns nonce 0 when every hash is below the target", () => {
    const challenge = "ab".repeat(120);
    expect(solveFaucetPow(challenge, 0xffffffffffffffffn, 4)).toBe(0);
  });

  it("throws once the nonce budget is exhausted", () => {
    const challenge = "ab".repeat(120);
    expect(() => solveFaucetPow(challenge, 0n, 8)).toThrow(/not solved/);
  });

  it("rejects a challenge that is not 120 bytes", () => {
    expect(() => solveFaucetPow("aa", 1n)).toThrow(/expected 120/);
  });
});

describe("faucetMintAmount", () => {
  it("uses one whole token, and 6 decimals when the faucet omits them", () => {
    expect(faucetMintAmount(6)).toBe(1_000_000);
    expect(faucetMintAmount(undefined)).toBe(1_000_000);
    expect(faucetMintAmount(0)).toBe(1);
  });
});

describe("hexToBytes", () => {
  it("decodes a pair", () => {
    expect(hexToBytes("0xff")).toEqual(new Uint8Array([255]));
  });
});
