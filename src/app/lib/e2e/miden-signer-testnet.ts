import type { Transaction } from "@miden-sdk/miden-wallet-adapter-base";
import type { E2EMidenSigner } from "./miden-signer";
import { parseAccountSeed } from "./faucet-pow";
import { requestTestnetFaucetNote } from "./miden-faucet";

// The harness owns this account. Bread only creates Guardian accounts, and
// those cannot be exported, so there is no account file to import. A public
// single-sig wallet is created from E2E_MIDEN_SEED (or imported from that
// seed once it is on chain). Receive uses the resulting address. Send asks
// the public testnet faucet for a note when the vault is still empty.

const TESTNET_RPC = "https://rpc.testnet.miden.io";
const TESTNET_TRANSPORT = "https://transport.miden.io";

type MidenSdk = typeof import("@miden-sdk/miden-sdk");

type E2EClient = {
  submitNewTransaction: (id: unknown, req: unknown) => Promise<unknown>;
  newSendTransactionRequest: (...args: unknown[]) => Promise<unknown>;
  getAccountVault: (id: unknown) => Promise<{
    fungibleAssets: () => Array<{ faucetId(): unknown; amount(): unknown }>;
  }>;
  getConsumableNotes: (id: unknown) => Promise<Array<{ inputNoteRecord(): unknown }>>;
  newConsumeTransactionRequest: (notes: unknown, accountId: unknown) => Promise<unknown>;
  syncState: () => Promise<unknown>;
  importPublicAccountFromSeed: (seed: Uint8Array, auth: unknown) => Promise<{ id(): { toString(): string; toBech32(n: unknown, i: unknown): string } }>;
  newWallet: (mode: unknown, auth: unknown, seed: Uint8Array) => Promise<{ id(): { toString(): string; toBech32(n: unknown, i: unknown): string } }>;
  getAccounts: () => Promise<Array<{ id(): { toString(): string; toBech32(n: unknown, i: unknown): string } }>>;
};

type ReadyClient = {
  client: E2EClient;
  accountId: { toString(): string; toBech32(n: unknown, i: unknown): string };
  address: string;
  sdk: MidenSdk;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function createTestnetMidenSignerImpl(seed: string): Promise<E2EMidenSigner> {
  const seedBytes = parseAccountSeed(seed);
  let readyPromise: Promise<ReadyClient> | null = null;
  let funded = false;

  function ready(): Promise<ReadyClient> {
    if (!readyPromise) readyPromise = openClient(seedBytes);
    return readyPromise;
  }

  async function ensureFunded(): Promise<void> {
    if (funded) return;
    const { client, accountId } = await ready();
    await client.syncState().catch(() => undefined);
    const vault = await client.getAccountVault(accountId).catch(() => null);
    const held = vault?.fungibleAssets() ?? [];
    if (held.some((asset) => BigInt(String(asset.amount())) > 0n)) {
      funded = true;
      return;
    }
    const waiting = await client.getConsumableNotes(accountId).catch(() => []);
    if (!waiting.length) await requestTestnetFaucetNote(accountId.toString());
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await client.syncState().catch(() => undefined);
      const records = await client.getConsumableNotes(accountId).catch(() => []);
      if (records.length) {
        const notes = records.map((record) => record.inputNoteRecord());
        const request = await client.newConsumeTransactionRequest(notes, accountId);
        await client.submitNewTransaction(accountId, request);
        await client.syncState().catch(() => undefined);
        funded = true;
        return;
      }
      await sleep(5_000);
    }
    throw new Error("testnet faucet note was minted but never became consumable");
  }

  async function submit(request: unknown): Promise<string> {
    const { client, accountId } = await ready();
    return String(await client.submitNewTransaction(accountId, request));
  }

  // Consume any bridged-in notes so their assets land in the vault. Best-effort
  // when nothing is waiting: a send that has not received yet is a no-op.
  async function consumeBridgedNotes(): Promise<void> {
    await ensureFunded();
    const { client, accountId } = await ready();
    await client.syncState().catch(() => undefined);
    const records = await client.getConsumableNotes(accountId).catch(() => []);
    if (!records.length) return;
    const notes = records.map((record) => record.inputNoteRecord());
    const request = await client.newConsumeTransactionRequest(notes, accountId);
    await client.submitNewTransaction(accountId, request);
    await client.syncState().catch(() => undefined);
  }

  const { address } = await ready();
  const expected = process.env.NEXT_PUBLIC_E2E_MIDEN_ACCOUNT_ID;
  if (expected && expected !== address && expected !== (await ready()).accountId.toString()) {
    throw new Error(
      `E2E_MIDEN_ACCOUNT_ID (${expected}) is not this seed's wallet (${address}). ` +
        "Unset it, or point it at the account this seed creates.",
    );
  }

  const requestTransaction = (async (transaction: Transaction) => {
    const payload = transaction.payload as { transactionRequest?: unknown };
    if (!payload?.transactionRequest) {
      throw new Error("E2E Miden signer: custom transaction is missing its request.");
    }
    await consumeBridgedNotes();
    return submit(payload.transactionRequest);
  }) as unknown as E2EMidenSigner["requestTransaction"];

  const requestSend = (async (transaction: Transaction) => {
    await consumeBridgedNotes();
    const { client, accountId, sdk } = await ready();
    const p = transaction.payload as unknown as {
      recipient: string;
      faucetId: string;
      amount: number | bigint;
    };
    const { AccountId, NoteType } = sdk;
    const request = await client.newSendTransactionRequest(
      accountId,
      AccountId.fromHex(p.recipient),
      AccountId.fromHex(p.faucetId),
      NoteType.Private,
      BigInt(p.amount),
    );
    return submit(request);
  }) as unknown as E2EMidenSigner["requestSend"];

  const waitForTransaction = (async () => {
    const { client } = await ready();
    for (let i = 0; i < 30; i += 1) {
      await client.syncState().catch(() => undefined);
      await sleep(5_000);
    }
  }) as unknown as E2EMidenSigner["waitForTransaction"];

  const requestAssets = (async () => {
    try {
      const { client, accountId } = await ready();
      const vault = await client.getAccountVault(accountId);
      return vault.fungibleAssets().map((asset) => ({
        faucetId: String(asset.faucetId()),
        amount: String(asset.amount()),
      }));
    } catch {
      return [];
    }
  }) as unknown as E2EMidenSigner["requestAssets"];

  const requestConsumableNotes = (async () => {
    try {
      const { client, accountId } = await ready();
      await client.syncState().catch(() => undefined);
      return await client.getConsumableNotes(accountId);
    } catch {
      return [];
    }
  }) as unknown as E2EMidenSigner["requestConsumableNotes"];

  return {
    address,
    requestSend,
    requestTransaction,
    waitForTransaction,
    requestAssets,
    requestConsumableNotes,
  };
}

async function openClient(seedBytes: Uint8Array): Promise<ReadyClient> {
  const sdk = await import("@miden-sdk/miden-sdk");
  const { WebClient, AccountStorageMode, AuthScheme, NetworkId, AccountInterface } = sdk;
  const client = (await new WebClient().createClient(
    TESTNET_RPC,
    TESTNET_TRANSPORT,
    seedBytes,
    "miden-bridge-e2e",
  )) as E2EClient;

  // Public, so a later run with an empty IndexedDB can import the same account
  // from the seed. A private account cannot. Falcon matches newWallet's scheme.
  const auth = AuthScheme.AuthRpoFalcon512;
  let account: { id(): ReadyClient["accountId"] };
  try {
    account = await client.importPublicAccountFromSeed(seedBytes, auth);
  } catch (importError) {
    try {
      account = await client.newWallet(AccountStorageMode.public(), auth, seedBytes);
    } catch (createError) {
      const existing = await client.getAccounts().catch(() => []);
      if (existing.length !== 1) {
        const why = importError instanceof Error ? importError.message : String(importError);
        const created = createError instanceof Error ? createError.message : String(createError);
        throw new Error(`seed wallet import failed (${why}); create failed (${created})`);
      }
      account = existing[0];
    }
  }

  const accountId = account.id();
  const address = accountId.toBech32(NetworkId.testnet(), AccountInterface.BasicWallet);
  await client.syncState().catch(() => undefined);
  return { client, accountId, address, sdk };
}
