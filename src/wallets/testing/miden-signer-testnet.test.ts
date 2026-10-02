import type { Transaction } from "@miden-sdk/miden-wallet-adapter-base";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTestnetMidenSignerImpl } from "./miden-signer-testnet";

const sdk = vi.hoisted(() => {
  // Model WASM ownership: getConsumableNotes invalidates its AccountId.
  class AccountId {
    private alive = true;
    constructor(private hex: string) {}
    static fromHex(hex: string) { return new AccountId(hex); }
    toString() {
      if (!this.alive) throw new Error("null pointer passed to rust");
      return this.hex;
    }
    toBech32() { return `bech32:${this.toString()}`; }
    consume() { this.toString(); this.alive = false; }
  }
  class Note {}
  const client = {
    importPublicAccountFromSeed: vi.fn(),
    newWallet: vi.fn(),
    getAccounts: vi.fn(),
    syncState: vi.fn(),
    getAccountVault: vi.fn(),
    getConsumableNotes: vi.fn(),
    newConsumeTransactionRequest: vi.fn(),
    submitNewTransaction: vi.fn(),
  };
  return { AccountId, Note, client, createClient: vi.fn(), faucet: vi.fn() };
});

vi.mock("@miden-sdk/miden-sdk", () => ({
  WasmWebClient: { createClient: sdk.createClient },
  AccountId: sdk.AccountId,
  AccountStorageMode: { public: () => "public" },
  AuthScheme: { AuthRpoFalcon512: "falcon" },
  NetworkId: { testnet: () => "testnet" },
  AccountInterface: { BasicWallet: "wallet" },
}));
vi.mock("./miden-faucet", () => ({ requestTestnetFaucetNote: sdk.faucet }));

const seed = "11".repeat(32);
const hex = "0xa22ec154f9a36d911953fd5c9260a7";
const asset = { faucetId: () => "fee-token", amount: () => 1n };
const transaction = { payload: { transactionRequest: { kind: "bridge" } } } as unknown as Transaction;
const note = () => {
  const value = new sdk.Note();
  return { value, record: { inputNoteRecord: () => ({ toNote: () => value }) } };
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_E2E_MIDEN_ACCOUNT_ID", "");
  const account = { id: () => sdk.AccountId.fromHex(hex) };
  sdk.createClient.mockResolvedValue(sdk.client);
  sdk.client.importPublicAccountFromSeed.mockResolvedValue(account);
  sdk.client.newWallet.mockResolvedValue(account);
  sdk.client.syncState.mockResolvedValue(undefined);
  sdk.client.getAccountVault.mockImplementation(async (id) => {
    id.toString();
    return { fungibleAssets: () => [asset] };
  });
  sdk.client.getConsumableNotes.mockImplementation(async (id) => {
    id.consume();
    return [];
  });
  sdk.client.newConsumeTransactionRequest.mockImplementation(async (notes, id) => {
    id.toString();
    for (const n of notes) expect(n).toBeInstanceOf(sdk.Note);
    return { kind: "consume" };
  });
  sdk.client.submitNewTransaction.mockImplementation(async (id) => {
    id.toString();
    return "tx-id";
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

it("uses the initialized JS client to import the seed wallet", async () => {
  const signer = await createTestnetMidenSignerImpl(seed);
  expect(signer.address).toBe(`bech32:${hex}`);
  expect(sdk.createClient).toHaveBeenCalledWith(
    "https://rpc.testnet.miden.io", "https://transport.miden.io",
    new Uint8Array(32).fill(17), "miden-bridge-e2e", undefined, false,
  );
  expect(sdk.client.newWallet).not.toHaveBeenCalled();
});

it("creates a public wallet when the seed has no on-chain account", async () => {
  sdk.client.importPublicAccountFromSeed.mockRejectedValue(new Error("not found"));
  const signer = await createTestnetMidenSignerImpl(seed);
  expect(signer.address).toBe(`bech32:${hex}`);
  expect(sdk.client.newWallet).toHaveBeenCalledWith("public", "falcon", new Uint8Array(32).fill(17));
});

it("keeps the account usable after repeated note queries and bridged-note consumption", async () => {
  const bridged = note();
  sdk.client.getConsumableNotes.mockImplementation(async (id) => {
    id.consume();
    return [bridged.record];
  });
  const signer = await createTestnetMidenSignerImpl(seed);
  expect(await signer.requestConsumableNotes()).toHaveLength(1);
  expect(await signer.requestConsumableNotes()).toHaveLength(1);
  await expect(signer.requestTransaction(transaction)).resolves.toBe("tx-id");
  expect(sdk.client.newConsumeTransactionRequest).toHaveBeenCalledWith([bridged.value], expect.any(sdk.AccountId));
  expect(await signer.requestAssets()).toEqual([{ faucetId: "fee-token", amount: "1" }]);
  expect(sdk.faucet).not.toHaveBeenCalled();
});

it("funds an empty wallet, polls with fresh handles and consumes the faucet Note", async () => {
  vi.useFakeTimers();
  const minted = note();
  const responses = [[], [], [minted.record], []];
  sdk.client.getAccountVault.mockResolvedValue({ fungibleAssets: () => [] });
  sdk.client.getConsumableNotes.mockImplementation(async (id) => {
    id.consume();
    return responses.shift() ?? [];
  });
  const signer = await createTestnetMidenSignerImpl(seed);
  const sent = expect(signer.requestTransaction(transaction)).resolves.toBe("tx-id");
  await vi.runAllTimersAsync();
  await sent;
  expect(sdk.faucet).toHaveBeenCalledExactlyOnceWith(hex);
  expect(sdk.client.newConsumeTransactionRequest).toHaveBeenCalledWith([minted.value], expect.any(sdk.AccountId));
  expect(sdk.client.submitNewTransaction).toHaveBeenCalledTimes(2);
});
