import { expect, type Page } from "@playwright/test";
import { Keypair, Transaction } from "@solana/web3.js";
import { installWallets } from "../fixtures/wallets";
import golden from "./solana-golden.json";

const signer = Keypair.fromSeed(new Uint8Array(32).fill(1));
const alternate = Keypair.fromSeed(new Uint8Array(32).fill(3));
export const SOURCE_ACCOUNT = signer.publicKey.toBase58();
export const RECIPIENT = golden.miden.bytes32;
export const RECIPIENT_ADDRESS = golden.miden.testnet;
export type WalletMode = "normal" | "reject" | "unsupported" | "missing-sign-only" | "changed-message" | "dropped-event" | "changed-provider" | "changed-account";
export type SignedRequest = { message: string; eventAccount: string; eventSignature: string; signedBytes: string; signature: string };

declare global {
  interface Window {
    helperFixture: {
      mode: WalletMode;
      walletCalls: number;
      storageFailure: "none" | "reviewed" | "signed";
      storageWrites: { id: string; attemptId: string; stage: string; signedBytes?: string }[];
      changeAccount: () => void;
      replaceProvider: () => void;
      disconnect: () => void;
    };
    signHelperFixture: (bytes: number[]) => Promise<number[]>;
  }
}

/** Inject only the public extension protocol. The application builds the IDL transaction. */
export async function installPhantom(page: Page, mode: WalletMode = "normal") {
  const requests: SignedRequest[] = [];
  await installWallets(page);
  await page.exposeFunction("signHelperFixture", (bytes: number[]) => {
    const transaction = Transaction.from(Buffer.from(bytes));
    expect(transaction.verifySignatures(false)).toBe(true);
    expect(transaction.feePayer?.toBase58()).toBe(SOURCE_ACCOUNT);
    expect(transaction.signatures).toHaveLength(2);
    const event = transaction.signatures.find(entry => !entry.publicKey.equals(signer.publicKey));
    expect(event?.signature).not.toBeNull();
    const message = transaction.serializeMessage().toString("base64");
    transaction.partialSign(signer);
    expect(transaction.verifySignatures()).toBe(true);
    requests.push({ message, eventAccount: event!.publicKey.toBase58(), eventSignature: event!.signature!.toString("hex"),
      signedBytes: transaction.serialize().toString("base64"), signature: transaction.signature!.toString("hex") });
    return [...transaction.signature!];
  });
  await page.addInitScript(({ address, alternateAddress, selectedMode }) => {
    sessionStorage.setItem("miden.bridge.ui.environment", "testnet");
    const listeners = new Map<string, Set<() => void>>();
    const publicKey = (value: string) => ({ toBase58: () => value, toString: () => value });
    const provider = {
      isPhantom: true, isConnected: false, publicKey: publicKey(address),
      connect: async () => { provider.isConnected = true; return { publicKey: provider.publicKey }; },
      disconnect: async () => { provider.isConnected = false; listeners.get("disconnect")?.forEach(listener => listener()); },
      on: (event: string, listener: () => void) => { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(listener); },
      removeListener: (event: string, listener: () => void) => listeners.get(event)?.delete(listener),
      signTransaction: async (transaction: {
        feePayer: unknown; recentBlockhash: string; serialize: (options: { requireAllSignatures: boolean }) => Uint8Array;
        signatures: { publicKey: { toBase58: () => string }; signature: Uint8Array | null }[];
        addSignature: (key: unknown, signature: Uint8Array) => void;
      }) => {
        window.helperFixture.walletCalls += 1;
        const mode = window.helperFixture.mode;
        if (mode === "reject" || mode === "unsupported") throw Object.assign(new Error(mode === "reject" ? "User rejected fixture signing" : "signTransaction unsupported"), { code: mode === "reject" ? 4001 : -32601 });
        const signature = await window.signHelperFixture([...transaction.serialize({ requireAllSignatures: false })]);
        transaction.addSignature(transaction.feePayer, new Uint8Array(signature));
        if (mode === "changed-message") transaction.recentBlockhash = alternateAddress;
        if (mode === "dropped-event") transaction.signatures.find(row => row.publicKey.toBase58() !== address)!.signature = null;
        if (mode === "changed-provider") window.helperFixture.replaceProvider();
        if (mode === "changed-account") window.helperFixture.changeAccount();
        return transaction;
      },
    };
    // The fixture intentionally implements just Phantom's documented surface;
    // its publicKey duck type is sufficient until the app constructs real keys.
    Object.assign(window, { phantom: { solana: provider } });
    window.helperFixture = {
      mode: selectedMode, walletCalls: 0, storageFailure: "none", storageWrites: [],
      changeAccount: () => { provider.publicKey = publicKey(alternateAddress); listeners.get("accountChanged")?.forEach(listener => listener()); },
      replaceProvider: () => { Object.assign(window, { phantom: { solana: { ...provider } } }); },
      disconnect: () => { void provider.disconnect(); },
    };
    if (selectedMode === "missing-sign-only") Object.assign(provider, { signTransaction: undefined });
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === "miden.bridge.ui.activities.v2") {
        const rows = JSON.parse(value) as { id: string; cctpHelper?: { attemptId: string; stage: string; signedBytes?: string } }[];
        for (const row of rows) if (row.cctpHelper) window.helperFixture.storageWrites.push({ id: row.id, attemptId: row.cctpHelper.attemptId, stage: row.cctpHelper.stage, signedBytes: row.cctpHelper.signedBytes });
        if (window.helperFixture.storageFailure !== "none" && rows.some(row => row.cctpHelper && (window.helperFixture.storageFailure === "reviewed" || row.cctpHelper.signedBytes)))
          throw new DOMException("Fixture storage quota exhausted", "QuotaExceededError");
      }
      return setItem.call(this, key, value);
    };
  }, { address: SOURCE_ACCOUNT, alternateAddress: alternate.publicKey.toBase58(), selectedMode: mode });
  return requests;
}
