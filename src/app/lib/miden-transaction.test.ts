import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@miden-sdk/miden-sdk", () => ({
  Word: class {
    constructor(private values: BigUint64Array) {}
    toU64s() { return this.values; }
  },
}));

import { createFeeConversionSalt } from "./miden-transaction";

describe("createFeeConversionSalt", () => {
  afterEach(() => vi.restoreAllMocks());

  it("rejects noncanonical field elements and draws new randomness on every call", () => {
    const modulus = 18_446_744_069_414_584_321n;
    const values = [modulus, modulus - 1n, 1n, 2n, 3n, 4n, 5n, 6n, 7n];
    const random = vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
      (array as unknown as BigUint64Array)[0] = values.shift()!;
      return array;
    });

    const first = createFeeConversionSalt();
    const second = createFeeConversionSalt();
    expect([...first.toU64s()]).toEqual([modulus - 1n, 1n, 2n, 3n]);
    expect([...second.toU64s()]).toEqual([4n, 5n, 6n, 7n]);
    expect(random).toHaveBeenCalledTimes(9);
  });

  it("fails instead of inventing a salt if secure randomness is unavailable", () => {
    vi.spyOn(crypto, "getRandomValues").mockImplementation(() => {
      throw new Error("randomness unavailable");
    });
    expect(() => createFeeConversionSalt()).toThrow("randomness unavailable");
  });
});
