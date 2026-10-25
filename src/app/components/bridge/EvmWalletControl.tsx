import { ChevronDown, Copy, ExternalLink, LogOut, RefreshCcw } from "lucide-react";
import { useAppKit, useDisconnect } from "@reown/appkit/react";
import { useEffect, useRef, useState } from "react";
import { ensureEvmNetwork } from "../../../wallets/evm/ensure-network";
import { evmWalletIdentity, shortAddress } from "../../../wallets/identity";
import { WalletBrandIcon } from "../../../wallets/WalletBrandIcon";
import { WalletMenu } from "../../../wallets/WalletMenu";
import { errorMessage } from "../../lib/wallet-errors";
import type { BridgeWallets } from "./use-bridge-wallets";

export function EvmWalletControl({ wallet, onConnect, onError }: {
  wallet: BridgeWallets["evm"];
  onConnect: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const { open } = useAppKit();
  const { disconnect } = useDisconnect();
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { connected, address, network, info } = wallet;
  const identity = evmWalletIdentity({ connected, address, networkLabel: network.name });

  useEffect(() => () => clearTimeout(copyTimer.current), []);
  useEffect(() => {
    if (!menuOpen) return;
    function closeMenu(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  async function runMenuAction(action: () => Promise<unknown>) {
    setMenuOpen(false);
    onError("");
    try { await action(); }
    catch (error) { onError(errorMessage(error)); }
  }

  async function switchNetwork() {
    if (!wallet.provider) throw new Error(`Connect your ${network.name} wallet first.`);
    await ensureEvmNetwork(wallet.provider, network);
  }

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1400);
    } catch {
      onError("Could not copy the wallet address from this browser.");
    }
  }

  return (
    <div className="wallet-menu-root" ref={menuRef}>
      <button
        className={`wallet-button wallet-pill ${connected ? "connected" : ""}`}
        type="button"
        onClick={() => connected ? setMenuOpen(current => !current) : void onConnect()}
        aria-expanded={connected ? menuOpen : undefined}
        aria-haspopup={connected ? "menu" : undefined}
        aria-label={identity.actionLabel}
      >
        <WalletBrandIcon src={connected ? info?.icon : undefined} size={18} />
        <span className="wallet-pill-label">{connected ? identity.pillLabel : "Connect wallet"}</span>
        {connected ? <ChevronDown className="wallet-menu-chevron" size={15} aria-hidden="true" /> : null}
      </button>
      {connected ? (
        <WalletMenu
          open={menuOpen}
          avatar={<span className="wallet-menu-avatar connected"><WalletBrandIcon src={info?.icon} size={20} /></span>}
          name={info?.name ?? network.name}
          subtitle={<>{shortAddress(address)} · {wallet.balanceText}</>}
        >
          <button type="button" role="menuitem" className="wallet-menu-item" onClick={() => void runMenuAction(() => open({ view: "Account" }))}>
            <RefreshCcw size={15} aria-hidden="true" /><span>Account permissions</span>
          </button>
          <button type="button" role="menuitem" className="wallet-menu-item" onClick={() => void runMenuAction(switchNetwork)}>
            <RefreshCcw size={15} aria-hidden="true" /><span>Switch to {network.name}</span>
          </button>
          <button type="button" role="menuitem" className="wallet-menu-item" onClick={copyAddress}>
            <Copy size={15} aria-hidden="true" /><span>{copied ? "Copied" : "Copy address"}</span>
          </button>
          <a role="menuitem" className="wallet-menu-item" href={`${network.blockExplorers.default.url}/address/${address}`} target="_blank" rel="noreferrer">
            <ExternalLink size={15} aria-hidden="true" /><span>View on {network.blockExplorers.default.name}</span>
          </a>
          <span className="wallet-menu-separator" />
          <button type="button" role="menuitem" className="wallet-menu-item danger" onClick={() => void runMenuAction(() => disconnect().catch(() => {}))}>
            <LogOut size={15} aria-hidden="true" /><span>Forget in app</span>
          </button>
        </WalletMenu>
      ) : null}
    </div>
  );
}
