import { expect, test } from "vitest";
import { EPOCH_ALLOCATOR_URL } from "./config";

test("allocator URL defaults to the testnet-dev endpoint", () => {
  expect(EPOCH_ALLOCATOR_URL).toBe("https://testnet-dev.epochprotocol.xyz");
});
