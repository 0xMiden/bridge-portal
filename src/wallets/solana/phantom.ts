import type { PublicKey, Transaction } from "@solana/web3.js";
export interface PhantomProvider {
  isPhantom: boolean;
  isConnected: boolean;
  publicKey: PublicKey | null;
  connect(): Promise<{ publicKey: PublicKey }>;
  disconnect(): Promise<void>;
  signTransaction?: (transaction: Transaction) => Promise<Transaction>;
  on?: (event: "accountChanged" | "disconnect", listener: () => void) => void;
  removeListener?: (event: "accountChanged" | "disconnect", listener: () => void) => void;
}
export interface PhantomSelection { provider: PhantomProvider; address: string }
declare global { interface Window { phantom?: { solana?: PhantomProvider } } }

export function injectedPhantom(): PhantomProvider | undefined {
  const provider = typeof window === "undefined" ? undefined : window.phantom?.solana;
  return provider?.isPhantom === true ? provider : undefined;
}
export function assertPhantomSelection(selection: PhantomSelection) {
  const { provider, address } = selection;
  if (injectedPhantom() !== provider || !provider.isConnected || provider.publicKey?.toBase58() !== address)
    throw new Error("Your selected Phantom (Solana) account or provider changed. Review again.");
  if (typeof provider.signTransaction !== "function") throw new Error("This Phantom provider does not support sign-only transactions. Submission is disabled.");
}
