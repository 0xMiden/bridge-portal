import { afterEach, expect, test, vi } from "vitest";
import { epochAllocatorUrl } from "./config";
import { currentBridgeConfig } from "../../../config/bridge-config";

afterEach(() => vi.unstubAllEnvs());

test("allocator URL defaults to the testnet-dev endpoint", () => {
  expect(epochAllocatorUrl()).toBe("https://testnet-dev.epochprotocol.xyz");
});

test("Cedar uses its mainnet allocator even when the legacy testnet override is set", () => {
  vi.stubEnv("NEXT_PUBLIC_EPOCH_ALLOCATOR_URL", "https://testnet-dev.epochprotocol.xyz");
  expect(epochAllocatorUrl(currentBridgeConfig("mainnet"))).toBe("https://mainnet-api.epochprotocol.xyz");
});
