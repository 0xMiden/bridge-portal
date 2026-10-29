import type { usePhantomSolana } from "./usePhantomSolana";
import { shortAddress } from "../identity";
export function PhantomSolanaWalletControl({ wallet }: { wallet: ReturnType<typeof usePhantomSolana> }) {
  return <button type="button" className="min-h-11 rounded-lg px-3 text-sm hover:bg-surface" aria-label={wallet.connected ? `Disconnect Phantom (Solana): ${wallet.address}` : "Connect Phantom (Solana)"}
    disabled={wallet.connecting} onClick={() => void (wallet.connected ? wallet.disconnect() : wallet.connect())}>
    {wallet.connected ? `Phantom ${shortAddress(wallet.address)}` : wallet.connecting ? "Connecting Phantom…" : "Phantom (Solana)"}
  </button>;
}
