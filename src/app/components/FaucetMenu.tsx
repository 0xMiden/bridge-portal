"use client";

import { useAppKitAccount, useAppKitProvider } from "@reown/appkit/react";
import { ArrowUpRight, Check, Droplets, Loader2 } from "lucide-react";
import { IconButton } from "./ui/Button";
import { useState, type ReactNode } from "react";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "./ui/Menu";
import { type EvmProvider } from "../../wallets/evm/evm-wallet";
import { useBalanceStore } from "../../bridge/BalanceProvider";
import { SEPOLIA_USDC } from "../../bridge/core/assets";
import {
  FAUCET_MINT_AMOUNT,
  MIDEN_TESTNET_FAUCET_URL,
  SEPOLIA_ETH_FAUCET_URL,
  mintSepoliaUsdc,
  sepoliaTxUrl,
} from "../lib/faucet";

type MintStatus =
  | { kind: "idle" }
  | { kind: "minting" }
  | { kind: "done"; hash: string }
  | { kind: "error"; message: string };

/**
 * Header popover for one-click testnet funding. Mints Epoch's Sepolia USDC mock
 * ERC20 straight from the connected wallet. Other Epoch mocks and Miden tokens
 * are available through the external faucet links.
 */
export function FaucetMenu() {
  const balances = useBalanceStore();
  const { address, isConnected } = useAppKitAccount();
  const { walletProvider } = useAppKitProvider<EvmProvider>("eip155");
  const [status, setStatus] = useState<MintStatus>({ kind: "idle" });
  const canMint = isConnected && !!address && !!walletProvider;

  const handleMint = async () => {
    if (!canMint || status.kind === "minting") return;
    setStatus({ kind: "minting" });
    try {
      const hash = await mintSepoliaUsdc({
        provider: walletProvider,
        account: address,
      });
      setStatus({ kind: "done", hash });
      void balances.invalidateSepolia(address, SEPOLIA_USDC);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Mint failed. Try again.";
      // User-rejected in the wallet reads back to idle rather than as an error.
      const rejected = /reject|denied|4001/i.test(message);
      setStatus(rejected ? { kind: "idle" } : { kind: "error", message });
    }
  };

  return (
      <Menu>
      <MenuTrigger asChild>
      <IconButton tone="accent" className="faucet-trigger"
        type="button"
        aria-label="Get testnet funds"
      >
        <Droplets size={18} aria-hidden="true" />
      </IconButton>
      </MenuTrigger>
        <MenuContent aria-label="Testnet faucet">
          <p className="mb-1 text-xs text-muted-foreground">Get testnet funds</p>

          <MenuItem keepOpen><a className="flex items-center justify-between gap-3 p-1" role="menuitem" href="https://faucet.circle.com/" target="_blank" rel="noopener noreferrer">
            <FaucetDescription title="Circle USDC">Arc, Ethereum Sepolia, Base Sepolia or Arbitrum Sepolia</FaucetDescription>
            <ArrowUpRight size={15} aria-hidden="true" />
          </a></MenuItem>

          <div className="flex items-center justify-between gap-3 p-1">
            <FaucetDescription title="Epoch test USDC">Mints {FAUCET_MINT_AMOUNT} to your wallet</FaucetDescription>
            <MenuItem keepOpen disabled={!canMint || status.kind === "minting"}><button
              className="inline-flex min-h-8 flex-none items-center gap-1 rounded-full bg-accent px-3 text-sm font-semibold whitespace-nowrap text-on-accent transition
                enabled:hover:brightness-105 disabled:bg-surface-strong disabled:text-muted-foreground"
              type="button"
              onClick={handleMint}
              disabled={!canMint || status.kind === "minting"}
              title={canMint ? undefined : "Connect your Sepolia wallet first"}
            >
              {status.kind === "minting" ? (
                <>
                  <Loader2 size={13} className="animate-spin" aria-hidden="true" />
                  Minting
                </>
              ) : status.kind === "done" ? (
                <>
                  <Check size={14} aria-hidden="true" />
                  Minted
                </>
              ) : (
                `Mint ${FAUCET_MINT_AMOUNT}`
              )}
            </button></MenuItem>
          </div>

          {status.kind === "done" ? (
            <MenuItem keepOpen><a
              className="inline-flex items-center gap-1 text-xs text-accent-foreground hover:underline"
              href={sepoliaTxUrl(status.hash)}
              target="_blank"
              rel="noopener noreferrer"
            >
              View mint transaction
              <ArrowUpRight size={12} aria-hidden="true" />
            </a></MenuItem>
          ) : null}
          {status.kind === "error" ? (
            <p className="text-xs text-danger-foreground wrap-anywhere">{status.message}</p>
          ) : null}

          <div className="mt-1.5 grid gap-0.5 border-t border-border pt-2">
            {[
              ["Epoch test token faucets", "https://userdashboard.epochprotocol.xyz/faucets"],
              ["Sepolia ETH (gas)", SEPOLIA_ETH_FAUCET_URL],
              ["Miden testnet faucet", MIDEN_TESTNET_FAUCET_URL],
            ].map(([label, href]) => (
              <MenuItem keepOpen key={href}>
                <a className="flex min-h-9 items-center justify-between gap-2 rounded-md px-1 text-xs text-muted-foreground hover:bg-surface-muted hover:text-foreground" href={href} target="_blank" rel="noopener noreferrer">
                  {label}<ArrowUpRight size={13} aria-hidden="true" />
                </a>
              </MenuItem>
            ))}
          </div>
        </MenuContent>
      </Menu>
  );
}

function FaucetDescription({ title, children }: { title: string; children: ReactNode }) {
  return <span className="min-w-0">
    <strong className="block text-sm font-semibold">{title}</strong>
    <small className="block text-xs text-muted-foreground">{children}</small>
  </span>;
}
