import type { MidenFiWalletContextState } from "@miden-sdk/miden-wallet-adapter-react";
import { normalizeMidenAccountHex } from "./agglayer";
import { EVM_AGGLAYER_NETWORK_ID, MIDEN_BRIDGE_ID } from "./agglayer-b2agg";

// Agglayer outbound (Miden → Sepolia / L2→L1). The B2AGG bridge-out note holds
// the Agglayer ETH faucet asset, and that faucet is CALLBACK-ENABLED: its vault
// representation carries a callback flag, so a plain `new FungibleAsset(faucet,
// amount)` builds a *different* asset commitment than the one the wallet holds.
// The note then tries to remove an asset the vault doesn't have → the tx fails
// with "amount of the asset in the vault is less than the amount to remove"
// (web-sdk#239 — there's no `with_callbacks`/`AssetCallbackFlag` in the JS API).
// The fix: build the request with the WebClient's `newB2AggTransactionRequest`,
// which constructs the callback-enabled asset internally, then submit the
// resulting TransactionRequest through the MidenFi wallet's `requestTransaction`.
//
// Loaded via dynamic import at click time — it pulls the eager-WASM SDK + the
// wallet adapter, so it must never enter the SSR/server bundle.

const TESTNET_RPC = "https://rpc.testnet.miden.io";
const TESTNET_TRANSPORT = "https://transport.miden.io";

// A read-only WebClient used only to build the B2AGG request (the MidenFi wallet
// signs + submits). Memoised so repeated sends reuse one client/store.
type B2AggClient = {
  // The raw client from `new WebClient().createClient()` exposes syncStateImpl;
  // the higher-level index.js wrapper exposes syncState(). Support either.
  syncState?: () => Promise<unknown>;
  syncStateImpl?: () => Promise<unknown>;
  newB2AggTransactionRequest: (
    sender: unknown,
    bridge: unknown,
    faucet: unknown,
    amount: bigint,
    destinationNetwork: number,
    destinationAddress: unknown,
  ) => Promise<unknown>;
};
let b2aggClientPromise: Promise<B2AggClient> | null = null;

async function getB2AggClient(
  sdk: typeof import("@miden-sdk/miden-sdk"),
): Promise<B2AggClient> {
  if (!b2aggClientPromise) {
    b2aggClientPromise = (async () => {
      const { WebClient } = sdk as unknown as {
        WebClient: new () => {
          createClient: (...a: unknown[]) => Promise<B2AggClient>;
        };
      };
      const client = await new WebClient().createClient(
        TESTNET_RPC,
        TESTNET_TRANSPORT,
        null,
        "miden-bridge-agglayer",
        false,
      );
      // Sync so the client knows the current chain / faucet state before it
      // builds the callback asset. The raw client exposes syncStateImpl; the
      // wrapper exposes syncState — call whichever is present, best-effort.
      if (typeof client.syncState === "function") {
        await client.syncState().catch(() => undefined);
      } else if (typeof client.syncStateImpl === "function") {
        await client.syncStateImpl().catch(() => undefined);
      }
      return client;
    })().catch((error) => {
      // Reset so a transient failure (offline / node hiccup) can retry next send.
      b2aggClientPromise = null;
      throw error;
    });
  }
  return b2aggClientPromise;
}

export interface AgglayerSendDeps {
  requestTransaction: NonNullable<
    MidenFiWalletContextState["requestTransaction"]
  >;
  waitForTransaction: NonNullable<
    MidenFiWalletContextState["waitForTransaction"]
  >;
}

export interface AgglayerSendResult {
  /** Wallet-adapter request id (a UUID) — internal tracking, NOT an on-chain id. */
  txId: string;
  /** The real on-chain Miden tx hash (0x + 64 hex), for the Midenscan link. */
  txHash: string;
}

export async function runAgglayerSend({
  amount,
  faucetId,
  destinationAddress,
  senderAddress,
  requestTransaction,
  waitForTransaction,
}: {
  /** Bridge-out amount in the Agglayer ETH faucet's base units. */
  amount: bigint;
  /**
   * The Agglayer ETH faucet the sender holds (the canonical bali faucet,
   * `AGGLAYER_BALI.midenEthFaucetIdHex`).
   */
  faucetId: string;
  /** Sepolia recipient, 0x-prefixed 20-byte EVM address. */
  destinationAddress: string;
  /** Sender Miden account — bech32 (mcst1…/mtst1…) or hex. */
  senderAddress: string;
} & AgglayerSendDeps): Promise<AgglayerSendResult> {
  const sdk = await import("@miden-sdk/miden-sdk");
  const { AccountId, EthAddress } = sdk;
  const { Transaction } = await import("@miden-sdk/miden-wallet-adapter-base");

  const sender = AccountId.fromHex(`0x${normalizeMidenAccountHex(senderAddress)}`);
  const bridge = AccountId.fromHex(MIDEN_BRIDGE_ID);
  const faucet = faucetId.startsWith("0x")
    ? AccountId.fromHex(faucetId)
    : AccountId.fromBech32(faucetId);

  // Build the bridge-out request with the SDK's B2AGG builder — it emits the
  // callback-enabled faucet asset the vault actually holds (web-sdk#239). A plain
  // Note.createB2AggNote(new FungibleAsset(...)) produced the wrong commitment.
  const client = await getB2AggClient(sdk);
  const request = (await client.newB2AggTransactionRequest(
    sender,
    bridge,
    faucet,
    amount,
    EVM_AGGLAYER_NETWORK_ID,
    EthAddress.fromHex(destinationAddress),
    // The SDK returns its own TransactionRequest; the wallet adapter re-exports
    // the same nominal type, so bridge it to what createCustomTransaction wants.
  )) as Parameters<typeof Transaction.createCustomTransaction>[2];

  // createCustomTransaction(address, recipientAddress, transactionRequest, …).
  // Both address fields carry the sender's Miden account (recipientAddress is
  // wallet display/tracking metadata, not the EVM destination).
  const transaction = Transaction.createCustomTransaction(
    senderAddress,
    senderAddress,
    request,
  );

  const txId = await requestTransaction(transaction);
  // requestTransaction returns the wallet's request id (a UUID); the real
  // on-chain tx hash only comes back on the settled TransactionOutput. Use that
  // for the Midenscan link — the UUID produces a broken /tx/ URL.
  const output = await waitForTransaction(txId);
  return { txId, txHash: output.txHash };
}
