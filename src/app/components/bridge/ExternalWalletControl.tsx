import { Menu, MenuTrigger } from "../ui/Menu";
import { Copy, ExternalLink, LogOut, RefreshCcw } from "lucide-react";
import { useAppKit, useDisconnect } from "@reown/appkit/react";
import { useEffect, useRef, useState } from "react";
import { ensureEvmNetwork } from "../../../wallets/evm/ensure-network";
import { externalWalletIdentity, shortAddress } from "../../../wallets/identity";
import { WalletBrandIcon } from "../../../wallets/WalletBrandIcon";
import { WalletMenu, WalletMenuItem, WalletButton } from "../../../wallets/WalletMenu";
import { errorMessage } from "../../lib/wallet-errors";
import type { BridgeWallets } from "./use-bridge-wallets";

export function ExternalWalletControl({ wallet, onConnect, onError }: {
  wallet: BridgeWallets["external"];
  onConnect: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const { open } = useAppKit();
  const { disconnect } = useDisconnect();
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { connected, address, networkLabel, namespace, explorer, info } = wallet;
  const identity = externalWalletIdentity({ connected, address, networkLabel });

  useEffect(() => () => clearTimeout(copyTimer.current), []);

  async function runMenuAction(action: () => Promise<unknown>) {
    setMenuOpen(false);
    onError("");
    try { await action(); }
    catch (error) { onError(errorMessage(error)); }
  }

  async function switchNetwork() {
    if (wallet.family !== "evm" || !wallet.provider) throw new Error(`Connect your ${networkLabel} wallet first.`);
    await ensureEvmNetwork(wallet.provider, wallet.network);
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
    <Menu open={menuOpen} onOpenChange={open => connected && setMenuOpen(open)}>
      <MenuTrigger asChild>
        <WalletButton
          connected={connected}
          showChevron={connected}
          type="button"
          onClick={() => { if (!connected) void onConnect(); }}
          aria-expanded={connected ? menuOpen : undefined}
          aria-haspopup={connected ? "menu" : undefined}
          aria-label={identity.actionLabel}
        >
          <WalletBrandIcon src={connected ? info?.icon : undefined} size={18} />
          <span className="wallet-pill-label truncate">{connected ? identity.pillLabel : "Connect wallet"}</span>
        </WalletButton>
      </MenuTrigger>
      {connected ? (
        <WalletMenu
          avatar={<WalletBrandIcon src={info?.icon} size={20} />} state="connected"
          name={info?.name ?? networkLabel}
          subtitle={<>{shortAddress(address)}{wallet.balanceText && ` · ${wallet.balanceText}`}</>}
        >
          <WalletMenuItem><button type="button" role="menuitem" onClick={() => void runMenuAction(() => open({ view: "Account", namespace }))}>
            <RefreshCcw size={15} aria-hidden="true" /><span>Account permissions</span>
          </button></WalletMenuItem>
          {wallet.family === "evm" && <WalletMenuItem><button type="button" role="menuitem" onClick={() => void runMenuAction(switchNetwork)}>
            <RefreshCcw size={15} aria-hidden="true" /><span>Switch to {networkLabel}</span>
          </button></WalletMenuItem>}
          <WalletMenuItem><button type="button" role="menuitem" onClick={copyAddress}>
            <Copy size={15} aria-hidden="true" /><span>{copied ? "Copied" : "Copy address"}</span>
          </button></WalletMenuItem>
          <WalletMenuItem><a role="menuitem" href={`${explorer.url}/address/${address}`} target="_blank" rel="noreferrer">
            <ExternalLink size={15} aria-hidden="true" /><span>View on {explorer.name}</span>
          </a></WalletMenuItem>
          <span className="wallet-menu-separator bg-border h-px m-1" />
          <WalletMenuItem danger><button type="button" role="menuitem" onClick={() => void runMenuAction(() => disconnect({ namespace }))}>
            <LogOut size={15} aria-hidden="true" /><span>Forget in app</span>
          </button></WalletMenuItem>
        </WalletMenu>
      ) : null}
    </Menu>
  );
}
