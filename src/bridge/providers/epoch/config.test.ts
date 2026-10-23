import { expect, test } from "vitest";
import { epochAllocatorUrl } from "./config";

test("allocator URL defaults to the testnet-dev endpoint", () => {
  expect(epochAllocatorUrl()).toBe("https://testnet-dev.epochprotocol.xyz");
});
