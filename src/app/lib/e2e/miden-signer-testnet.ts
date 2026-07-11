import type { Transaction } from "@miden-sdk/miden-wallet-adapter-base";
import type { E2EMidenSigner } from "./miden-signer";

// ⚠️ UNVALIDATED against the live network — this is the one harness piece that
// needs a funded Miden testnet account to verify. It reimplements the slice of
// the MidenFi adapter the bridge uses (submit a TransactionRequest with a
// headless key), using @miden-sdk WebClient's one-call prove+submit path
// (`submitNewTransaction`). Structure + API calls are grounded in the shipped
// .d.ts; the account-derivation-from-seed step (marked below) is the most
// likely thing to adjust when validating with a real seed.

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
  const sdk = await import("@miden-sdk/miden-sdk");
  const { WebClient, AccountId } = sdk;

  const seedBytes = hexToBytes(seed);
  const client = await new WebClient().createClient(
    TESTNET_RPC,
    TESTNET_TRANSPORT,
    seedBytes,
    "miden-bridge-e2e",
    false,
  );

  // ── account derivation (VALIDATE THIS) ──────────────────────────────────
  // The funded account id must be supplied so the client can track it. Prefer
  // an explicit id env; recreating the wallet from `seed` is the alternative
  // but must match how the account was originally funded.
  const accountIdHex = process.env.NEXT_PUBLIC_E2E_MIDEN_ACCOUNT_ID;
  if (!accountIdHex) {
    throw new Error(
      "Set NEXT_PUBLIC_E2E_MIDEN_ACCOUNT_ID to the funded Miden testnet account id (hex).",
    );
  }
  const accountId = AccountId.fromHex(accountIdHex);
  await client.importAccountById(accountId).catch(() => undefined);
  await client.syncState();

  async function submitRequest(request: unknown): Promise<string> {
    // submitNewTransaction proves, submits, and applies in one call.
    const txId = await client.submitNewTransaction(
      accountId,
      request as never,
    );
    return String(txId);
  }

  const requestTransaction = (async (transaction: Transaction) => {
    // Custom tx: the pre-built TransactionRequest rides in the payload.
    const payload = transaction.payload as { transactionRequest?: unknown };
    if (!payload?.transactionRequest) {
      throw new Error("E2E Miden signer: custom transaction is missing its request.");
    }
    return submitRequest(payload.transactionRequest);
  }) as unknown as E2EMidenSigner["requestTransaction"];

  const requestSend = (async (transaction: Transaction) => {
    // Send tx: build a P2ID request from the payload, then submit.
    const p = transaction.payload as unknown as {
      recipient: string;
      faucetId: string;
      amount: number | bigint;
      noteType?: string;
    };
    const { NoteType } = sdk;
    const request = await client.newSendTransactionRequest(
      accountId,
      AccountId.fromHex(p.recipient),
      AccountId.fromHex(p.faucetId),
      NoteType.Private,
      BigInt(p.amount),
    );
    return submitRequest(request);
  }) as unknown as E2EMidenSigner["requestSend"];

  const waitForTransaction = (async () => {
    // Poll chain sync a few times so the submitted tx commits.
    for (let i = 0; i < 30; i += 1) {
      await client.syncState();
      await new Promise((r) => setTimeout(r, 5000));
    }
  }) as unknown as E2EMidenSigner["waitForTransaction"];

  const requestAssets = (async () => {
    const vault = await client.getAccountVault(accountId);
    return vault
      .fungibleAssets()
      .map((a: { faucetId(): unknown; amount(): unknown }) => ({
        faucetId: String(a.faucetId()),
        amount: String(a.amount()),
      }));
  }) as unknown as E2EMidenSigner["requestAssets"];

  const requestConsumableNotes = (async () =>
    []) as unknown as E2EMidenSigner["requestConsumableNotes"];

  return {
    address: accountIdHex,
    requestSend,
    requestTransaction,
    waitForTransaction,
    requestAssets,
    requestConsumableNotes,
  };
}
