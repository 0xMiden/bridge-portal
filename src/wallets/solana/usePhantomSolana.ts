"use client";
import { useEffect, useState } from "react";
import { assertPhantomSelection, injectedPhantom, type PhantomSelection } from "./phantom";

export function usePhantomSolana() {
  const [selection, setSelection] = useState<PhantomSelection>();
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(false);
  useEffect(() => {
    if (!selection) return;
    const invalidate = () => {
      setSelection(undefined);
      setError("Your Phantom (Solana) connection changed. Connect and review again.");
    };
    const check = () => { try { assertPhantomSelection(selection); } catch { invalidate(); } };
    selection.provider.on?.("accountChanged", invalidate);
    selection.provider.on?.("disconnect", invalidate);
    const timer = setInterval(check, 300);
    return () => { clearInterval(timer); selection.provider.removeListener?.("accountChanged", invalidate); selection.provider.removeListener?.("disconnect", invalidate); };
  }, [selection]);
  async function connect() {
    setError(""); setConnecting(true);
    try {
      const provider = injectedPhantom();
      if (!provider) throw new Error("Install or unlock the Phantom (Solana) extension to connect.");
      if (typeof provider.signTransaction !== "function") throw new Error("This Phantom provider does not support sign-only transactions. Submission is disabled.");
      const result = await provider.connect();
      const selected = { provider, address: result.publicKey.toBase58() };
      assertPhantomSelection(selected); setSelection(selected);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Phantom connection was rejected."); }
    finally { setConnecting(false); }
  }
  async function disconnect() { await selection?.provider.disconnect(); setSelection(undefined); }
  return { selection, address: selection?.address ?? "", connected: !!selection, error, connecting, connect, disconnect };
}
