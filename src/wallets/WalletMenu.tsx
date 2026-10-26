"use client";

import type { ComponentProps, ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { MenuContent, MenuItem } from "../app/components/ui/Menu";

/** Wallet identity and actions share the same accessible menu surface. */
export function WalletMenu({ avatar, state, name, subtitle, children }: {
  avatar: ReactNode;
  state?: "connected" | "pending";
  name: ReactNode;
  subtitle: ReactNode;
  children: ReactNode;
}) {
  return (
    <MenuContent className="wallet-actions-menu" aria-label={typeof name === "string" ? name : "Wallet"}>
      <div className="flex items-center gap-3 border-b border-border px-2 pt-2 pb-3.5">
        <span className={`grid size-10 shrink-0 place-items-center rounded-md ${state === "connected" ? "bg-accent-soft text-accent" : state === "pending" ? "bg-warning-soft text-warning-foreground" : "bg-surface-muted text-muted-foreground"}`} data-state={state}>{avatar}</span>
        <span className="grid min-w-0 gap-0.5">
          <strong className="truncate text-sm font-semibold">{name}</strong>
          <small className="text-xs text-muted-foreground wrap-anywhere">{subtitle}</small>
        </span>
      </div>
      {children}
    </MenuContent>
  );
}

export function WalletMenuItem({ danger = false, children }: { danger?: boolean; children: ReactNode }) {
  return <MenuItem keepOpen data-danger={danger} className={`wallet-menu-item flex min-h-11 items-center gap-2 rounded-md px-3 text-left text-sm
    hover:bg-surface-muted data-[highlighted]:bg-surface-muted [&>svg]:shrink-0
    ${danger ? "text-danger-foreground" : "text-foreground"}`}>{children}</MenuItem>;
}

export function WalletButton({ connected = false, showChevron = true, className = "", children, ...props }: ComponentProps<"button"> & { connected?: boolean; showChevron?: boolean }) {
  return <button {...props} data-connected={connected} className={`wallet-button wallet-pill group/wallet flex min-h-9 w-full min-w-0 items-center justify-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-2 text-xs/normal font-medium [&_.wallet-pill-label]:tracking-[-0.01em] mobile:min-h-11
    hover:border-border-strong hover:bg-surface-muted aria-expanded:border-border-strong aria-expanded:bg-surface-muted ${connected ? "text-foreground" : "text-accent-foreground"} ${className}`}>
    {children}
    {showChevron && <ChevronDown size={12} className="shrink-0 group-aria-expanded/wallet:rotate-180" aria-hidden="true" />}
  </button>;
}
