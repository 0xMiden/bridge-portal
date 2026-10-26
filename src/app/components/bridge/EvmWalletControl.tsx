import { Menu, MenuTrigger } from "../ui/Menu";
import { Copy, ExternalLink, LogOut, RefreshCcw } from "lucide-react";
import { useAppKit, useDisconnect } from "@reown/appkit/react";
import { useEffect, useRef, useState } from "react";
import { ensureEvmNetwork } from "../../../wallets/evm/ensure-network";
import { evmWalletIdentity, shortAddress } from "../../../wallets/identity";
import { WalletBrandIcon } from "../../../wallets/WalletBrandIcon";
import { WalletMenu, WalletMenuItem, WalletButton } from "../../../wallets/WalletMenu";
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
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { connected, address, network, info } = wallet;
  const identity = evmWalletIdentity({ connected, address, networkLabel: network.name });

  useEffect(() => () => clearTimeout(copyTimer.current), []);

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
          name={info?.name ?? network.name}
          subtitle={<>{shortAddress(address)} · {wallet.balanceText}</>}
        >
          <WalletMenuItem><button type="button" role="menuitem" onClick={() => void runMenuAction(() => open({ view: "Account" }))}>
            <RefreshCcw size={15} aria-hidden="true" /><span>Account permissions</span>
          </button></WalletMenuItem>
          <WalletMenuItem><button type="button" role="menuitem" onClick={() => void runMenuAction(switchNetwork)}>
            <RefreshCcw size={15} aria-hidden="true" /><span>Switch to {network.name}</span>
          </button></WalletMenuItem>
          <WalletMenuItem><button type="button" role="menuitem" onClick={copyAddress}>
            <Copy size={15} aria-hidden="true" /><span>{copied ? "Copied" : "Copy address"}</span>
          </button></WalletMenuItem>
          <WalletMenuItem><a role="menuitem" href={`${network.blockExplorers.default.url}/address/${address}`} target="_blank" rel="noreferrer">
            <ExternalLink size={15} aria-hidden="true" /><span>View on {network.blockExplorers.default.name}</span>
          </a></WalletMenuItem>
          <span className="wallet-menu-separator bg-border h-px m-1" />
          <WalletMenuItem danger><button type="button" role="menuitem" onClick={() => void runMenuAction(() => disconnect().catch(() => {}))}>
            <LogOut size={15} aria-hidden="true" /><span>Forget in app</span>
          </button></WalletMenuItem>
        </WalletMenu>
      ) : null}
      </Menu>
  );
}
