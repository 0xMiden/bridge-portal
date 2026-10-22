import "../../../tests/setup/viem-http";
import { afterEach, expect, it, vi } from "vitest";
import { captureSourceTransaction } from "./source-transaction";

const hash = `0x${"aa".repeat(32)}`;
const account = `0x${"11".repeat(20)}`;
const transaction = {
  hash, from: account, to: null, input: "0x", nonce: "0x7", value: "0x10", blockNumber: null,
};

afterEach(() => vi.unstubAllGlobals());

it("captures validated RPC identity in the persisted decimal format", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ result: transaction })));
  await expect(captureSourceTransaction("ethereum", hash)).resolves.toEqual({
    hash, from: account, to: null, input: "0x", nonce: 7, value: "16",
  });
});

it("rejects an unsafe RPC nonce instead of persisting a rounded recovery identity", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
    result: { ...transaction, nonce: "0x20000000000000" },
  })));
  await expect(captureSourceTransaction("ethereum", hash)).rejects.toThrow();
});
