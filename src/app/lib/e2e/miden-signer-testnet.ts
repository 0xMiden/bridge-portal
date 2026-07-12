import type { Transaction } from "@miden-sdk/miden-wallet-adapter-base";
import type { E2EMidenSigner } from "./miden-signer";

// ⚠️ The Miden send path is the one harness piece needing a funded testnet
// account to validate. Receive only needs the account ADDRESS (the app deposits
// into it on Sepolia), so the signer exposes that immediately and builds the
// heavy @miden-sdk WebClient lazily on first send — a broken client / missing
// CLI never blocks the receive specs.

const TESTNET_RPC = "https://rpc.testnet.miden.io";
const TESTNET_TRANSPORT = "https://transport.miden.io";

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export async function createTestnetMidenSignerImpl(
  seed: string,
): Promise<E2EMidenSigner> {
  const envAccountId = process.env.NEXT_PUBLIC_E2E_MIDEN_ACCOUNT_ID;
  if (!envAccountId) {
    throw new Error(
      "Set E2E_MIDEN_ACCOUNT_ID to your funded Miden testnet account (bech32 mtst1… or 0x hex).",
    );
  }
  const accountIdStr: string = envAccountId;

  // Lazy, memoised WebClient — created only when a send is actually attempted.
  let clientPromise: Promise<{
    client: {
      submitNewTransaction: (id: unknown, req: unknown) => Promise<unknown>;
      newSendTransactionRequest: (...args: unknown[]) => Promise<unknown>;
      getAccountVault: (id: unknown) => Promise<{
        fungibleAssets: () => Array<{ faucetId(): unknown; amount(): unknown }>;
      }>;
      getConsumableNotes: (
        id: unknown,
      ) => Promise<Array<{ inputNoteRecord(): unknown }>>;
      newConsumeTransactionRequest: (notes: unknown) => unknown;
      syncState: () => Promise<unknown>;
    };
    accountId: unknown;
    sdk: typeof import("@miden-sdk/miden-sdk");
  }> | null = null;

  function getClient() {
    if (!clientPromise) {
      clientPromise = (async () => {
        const sdk = await import("@miden-sdk/miden-sdk");
        const { WebClient, AccountId } = sdk;
        const accountId = accountIdStr.startsWith("mtst1")
          ? AccountId.fromBech32(accountIdStr)
          : AccountId.fromHex(accountIdStr);
        const client = await new WebClient().createClient(
          TESTNET_RPC,
          TESTNET_TRANSPORT,
          hexToBytes(seed),
          "miden-bridge-e2e",
          false,
        );
        await client.importAccountById(accountId).catch(() => undefined);
        await client.syncState().catch(() => undefined);
        return { client, accountId, sdk } as never;
      })();
    }
    return clientPromise;
  }

  async function submit(request: unknown): Promise<string> {
    const { client, accountId } = await getClient();
    return String(await client.submitNewTransaction(accountId, request));
  }

  // Consume any bridged-in notes so their assets land in the account vault and
  // become spendable — the account only holds this seed, so nothing else will
  // consume them. Called before a send so a settled receive self-funds the
  // round-trip. Best-effort: no consumable notes = no-op.
  async function consumeBridgedNotes(): Promise<void> {
    const { client, accountId } = await getClient();
    await client.syncState().catch(() => undefined);
    const records = (await client
      .getConsumableNotes(accountId)
      .catch(() => [])) as Array<{ inputNoteRecord(): unknown }>;
    if (!records.length) return;
    const notes = records.map((r) => r.inputNoteRecord());
    const request = client.newConsumeTransactionRequest(notes as never);
    await client.submitNewTransaction(accountId, request as never);
    await client.syncState().catch(() => undefined);
  }

  const requestTransaction = (async (transaction: Transaction) => {
    const payload = transaction.payload as { transactionRequest?: unknown };
    if (!payload?.transactionRequest) {
      throw new Error("E2E Miden signer: custom transaction is missing its request.");
    }
    await consumeBridgedNotes(); // self-fund from a settled receive
    return submit(payload.transactionRequest);
  }) as unknown as E2EMidenSigner["requestTransaction"];

  const requestSend = (async (transaction: Transaction) => {
    await consumeBridgedNotes(); // self-fund from a settled receive
    const { client, accountId, sdk } = await getClient();
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
    const { client } = await getClient();
    for (let i = 0; i < 30; i += 1) {
      await client.syncState().catch(() => undefined);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }) as unknown as E2EMidenSigner["waitForTransaction"];

  const requestAssets = (async () => {
    try {
      const { client, accountId } = await getClient();
      const vault = await client.getAccountVault(accountId);
      return vault.fungibleAssets().map((a) => ({
        faucetId: String(a.faucetId()),
        amount: String(a.amount()),
      }));
    } catch {
      return [];
    }
  }) as unknown as E2EMidenSigner["requestAssets"];

  const requestConsumableNotes = (async () => {
    try {
      const { client, accountId } = await getClient();
      await client.syncState().catch(() => undefined);
      return await client.getConsumableNotes(accountId);
    } catch {
      return [];
    }
  }) as unknown as E2EMidenSigner["requestConsumableNotes"];

  return {
    address: accountIdStr,
    requestSend,
    requestTransaction,
    waitForTransaction,
    requestAssets,
    requestConsumableNotes,
  };
}
