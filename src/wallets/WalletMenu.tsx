"use client";

import type { ReactNode } from "react";

/**
 * Shared dropdown shell for both wallet menus (Sepolia/EVM + Miden/Bread), so
 * they have the exact same layout, width, and open/close animation — only the
 * identity summary and the action items differ. The parent always renders it
 * (mounted even when closed) and toggles `open`, so the `.open` transition
 * plays the same way for both.
 */
export function WalletMenu({
  open,
  avatar,
  name,
  subtitle,
  children,
}: {
  open: boolean;
  avatar: ReactNode;
  name: ReactNode;
  subtitle: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={`wallet-actions-menu ${open ? "open" : ""}`} role="menu">
      <div className="wallet-menu-summary">
        {avatar}
        <span>
          <strong>{name}</strong>
          <small>{subtitle}</small>
        </span>
      </div>
      {children}
    </div>
  );
}
