import { expect, it, vi } from "vitest";
import { withdrawUsdcx } from "./withdrawal-execute";

const { minimumWord, storageRaw } = vi.hoisted(() => {
  const minimumWord = { toFelts: () => [{ asInt: () => 3_000_000n }], toU64s: () => [3_000_000n], free: vi.fn() };
  const storageRaw = { getItem: () => minimumWord, getMapItem: () => ({ toFelts: () => [{ asInt: () => 1n }], toU64s: () => [1n], free() {} }), free: vi.fn() };
  return { minimumWord, storageRaw };
});
vi.mock("../../../wallets/miden/miden-transaction", () => ({ createFeeConversionSalt: vi.fn() }));
vi.mock("@miden-sdk/miden-wallet-adapter-base", () => ({ Transaction: {} }));
vi.mock("@miden-sdk/miden-sdk", () => ({
  AccountId: { fromHex: vi.fn() }, Endpoint: class {},
  NoteScript: { burn: () => ({ root: () => ({ free() {} }), free() {} }) },
  RpcClient: class {
    async getAccountDetails() {
      return {
        account: () => ({
          // Public SDK Account.storage() returns StorageView, whose getItem
          // returns StorageResult. Neither JS wrapper implements free().
          storage: () => ({ raw: storageRaw, getItem: () => ({ toFelts: minimumWord.toFelts }), getMapItem: storageRaw.getMapItem }),
          free() {},
        }),
        free() {},
      };
    }
    free() {}
  },
}));

it("preserves the faucet minimum error when cleaning up SDK storage wrappers", async () => {
  const requestTransaction = vi.fn();
  await expect(withdrawUsdcx({
    amount: "2", network: "arc-testnet", destination: "0x1122334455667788990011223344556677889900",
    sender: "0x4e6fb40fd2f6a55140df2c42dfb5b7", requestTransaction,
    waitForTransaction: vi.fn(), onSubmitted: vi.fn(),
  })).rejects.toThrow("The faucet requires at least 3 USDCx per withdrawal.");
  expect(requestTransaction).not.toHaveBeenCalled();
  expect(minimumWord.free).toHaveBeenCalledOnce();
  expect(storageRaw.free).toHaveBeenCalledOnce();
});
