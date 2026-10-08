import { expect, it } from "vitest";
import { parseArcDepositIntent } from "./attestation";

// Public Circle response for Arc tx 0x73b61e…5c6117, retrieved 2026-09-28.
const payload =
  "0x5a2e0acd0000000100000000000000000000000000000000000000000000000000000000000f42400000271700000000000000000000000000000000179f749ee2329e317d96fe3ed5aaf900000000000000000000000000000000005024c9a49c795e4154919db81f9176000000000000000000000000003600000000000000000000000000000000000000000000000000000000000000898362f24c366fdf7bb164c40a9127cc9f5119b60000000000000000000000000000000000000000000000000000000000000000abab9dfff95292a7b7ff97b193c2f17ac361ca98e3b9f15fed8d508795fc422000000000";
it("decodes the deployed faucet, recipient, amount and nonce from a real Circle response", () => {
  expect(parseArcDepositIntent(payload)).toEqual({
    amount: "1000000",
    recipient: "0x5024c9a49c795e4154919db81f9176",
    faucet: "0x179f749ee2329e317d96fe3ed5aaf9",
    sender: "0x898362f24c366fdf7bb164c40a9127cc9f5119b6",
    nonce: "0xabab9dfff95292a7b7ff97b193c2f17ac361ca98e3b9f15fed8d508795fc4220",
  });
});
it.each([
  payload.slice(0, -2),
  payload + "00",
  payload.replace("5a2e0acd", "ffffffff"),
  payload.replace("00002717", "00002715"),
  payload.replace("360000", "370000"),
  payload.slice(0, 346) + "1".padStart(64, "0") + payload.slice(410), // unsupported fee
  payload.slice(0, -8) + "00000001aa", // unsupported hook
  payload.replace(
    "5024c9a49c795e4154919db81f917600",
    "5024c9a49c795e4154919db81f917601",
  ),
])("rejects malformed or unrelated deposit payloads", (value) => {
  expect(() => parseArcDepositIntent(value)).toThrow();
});
it("rejects a u64 amount that exceeds the Miden faucet asset limit", () => {
  const tooLarge = ((1n << 63n) - (1n << 31n) + 1n).toString(16).padStart(64, "0");
  expect(() => parseArcDepositIntent(payload.slice(0, 18) + tooLarge + payload.slice(82))).toThrow("amount");
});
