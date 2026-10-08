export function shortAddress(value: string) {
  if (value.length <= 16) return value;
  return `${value.slice(0, 6)}...${value.slice(-6)}`;
}

// ── Chain-specific wallet identity (issue #54) ──────────────────────────────
// The bridge needs two wallets. They used to render as identical "Connect
// wallet" pills, leaving users to infer which control belonged to Sepolia and
// which to Miden. These helpers give each control an explicit chain/product
// name, a distinguishing accessible name, and a short state line — one source
// of truth shared by the header pills and the From/To panels.

export const SEPOLIA_WALLET_NAME = "Sepolia wallet";
export const MIDEN_WALLET_NAME = "Bread";

export type WalletControlState =
  | "idle"
  | "connecting"
  | "connected"
  | "unavailable";

export type WalletIdentity = {
  /** Chain/product name, e.g. "Sepolia wallet" / "Miden wallet" / "MidenFi". */
  name: string;
  /** Short label for the header pill. */
  pillLabel: string;
  /** Accessible name for the header control — distinguishes the two pills. */
  actionLabel: string;
  /** Inline connection state for the From/To panel. */
  stateText: string;
  state: WalletControlState;
};

export type EvmWalletView = {
  connected: boolean;
  connecting?: boolean;
  address: string;
  networkLabel?: string;
};

export function evmWalletIdentity(view: EvmWalletView): WalletIdentity {
  const network = view.networkLabel ?? "Sepolia";
  const name = `${network} wallet`;
  if (view.connecting) {
    return {
      name,
      pillLabel: "Connecting",
      actionLabel: `Connecting ${name}`,
      stateText: "Connecting…",
      state: "connecting",
    };
  }
  if (!view.connected) {
    return {
      name,
      pillLabel: name,
      actionLabel: `Connect ${name}`,
      stateText: "Not connected",
      state: "idle",
    };
  }
  return {
    name,
    pillLabel: shortAddress(view.address),
    actionLabel: `${name} menu`,
    stateText: shortAddress(view.address),
    state: "connected",
  };
}

export type MidenWalletView = {
  connecting: boolean;
  connected: boolean;
  /** MidenFi extension present + loadable. When false the wallet is unavailable. */
  ready: boolean;
  address: string;
};

export function midenWalletIdentity(view: MidenWalletView): WalletIdentity {
  if (view.connecting) {
    return {
      name: MIDEN_WALLET_NAME,
      pillLabel: "Connecting",
      actionLabel: "Connecting Bread wallet",
      stateText: "Connecting…",
      state: "connecting",
    };
  }
  if (view.connected) {
    return {
      name: MIDEN_WALLET_NAME,
      pillLabel: shortAddress(view.address),
      actionLabel: "Bread wallet menu",
      stateText: shortAddress(view.address),
      state: "connected",
    };
  }
  if (!view.ready) {
    // Explicit unavailable state — never the generic "Install wallet", and it
    // doesn't read as though a wallet were already connected.
    return {
      name: "Bread",
      pillLabel: "Bread not installed",
      actionLabel: "Bread wallet not installed",
      stateText: "Not installed",
      state: "unavailable",
    };
  }
  return {
    name: MIDEN_WALLET_NAME,
    pillLabel: MIDEN_WALLET_NAME,
    actionLabel: "Connect Bread wallet",
    stateText: "Not connected",
    state: "idle",
  };
}

/**
 * Deterministic account-avatar gradient derived from an address (Uniswap-style):
 * two hues seeded from the string so each account has a stable, distinct swatch.
 */
export function walletGradient(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const a = h % 360;
  const b = (a + 60 + ((h >> 8) % 120)) % 360;
  return `linear-gradient(135deg, hsl(${a} 72% 58%), hsl(${b} 68% 46%))`;
}
