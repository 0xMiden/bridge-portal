import { expect, it, vi } from "vitest";
import { withdrawUsdcx } from "./withdrawal-execute";

vi.mock("../../../wallets/miden/miden-transaction", () => ({ createFeeConversionSalt: vi.fn() }));
vi.mock("@miden-sdk/miden-wallet-adapter-base", () => ({ Transaction: {} }));
vi.mock("@miden-sdk/miden-sdk", () => ({
  AccountId: { fromHex: vi.fn() }, Endpoint: class {},
  NoteScript: { burn: () => ({ root: () => ({ toHex: () => "burn-root" }), free() {} }) },
  SlotAndKeys: class {},
  AccountStorageRequirements: { fromSlotAndKeysArray: () => ({}) },
  RpcClient: class {
    async getAccountDetails() {
      throw "Miden node response is missing expected field 'cannot build account: storage map slot 'xusdc::xreserve::nonce_registry::used_nonces' has too many entries'";
    }
    async getAccountProof() {
      return {
        getStorageSlotValue: () => ({ toU64s: () => [3_000_000n], free() {} }),
        getStorageMapEntries: () => [{
          key: () => ({ toHex: () => "burn-root", free() {} }),
          value: () => ({ toU64s: () => [1n], free() {} }),
          free() {},
        }],
        free() {},
      };
    }
    free() {}
  },
}));

it("checks the burn minimum even when the faucet nonce map cannot be fetched in full", async () => {
  const requestTransaction = vi.fn();
  await expect(withdrawUsdcx({
    amount: "2", network: "arc-testnet", destination: "0x1122334455667788990011223344556677889900",
    sender: "0x4e6fb40fd2f6a55140df2c42dfb5b7", requestTransaction,
    waitForTransaction: vi.fn(), onSubmitted: vi.fn(),
  })).rejects.toThrow("The faucet requires at least 3 USDCx per withdrawal.");
  expect(requestTransaction).not.toHaveBeenCalled();
});
