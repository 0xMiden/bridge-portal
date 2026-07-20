"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { BridgeProvider } from "../lib/bridge-state";

// Each bridgeable token maps 1:1 to the route that carries it (Epoch = USDC,
// Agglayer = ETH). Structured as a list so more tokens/routes drop in later.
type Token = {
  symbol: string;
  name: string;
  provider: BridgeProvider;
};

const TOKENS: Token[] = [
  { symbol: "USDC", name: "USD Coin", provider: "epoch" },
  { symbol: "ETH", name: "Ether", provider: "agglayer" },
];

function TokenIcon({ symbol, size = 22 }: { symbol: string; size?: number }) {
  if (symbol === "ETH") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="token-icon"
      >
        <circle cx="12" cy="12" r="12" fill="#627EEA" />
        <g fill="#fff">
          <path d="M12 3.5v6.34l5.36 2.4z" fillOpacity="0.6" />
          <path d="M12 3.5L6.64 12.24 12 9.84z" />
          <path d="M12 16.16v4.34l5.36-7.42z" fillOpacity="0.6" />
          <path d="M12 20.5v-4.34l-5.36-3.08z" />
          <path d="M12 15.16l5.36-2.92L12 9.84z" fillOpacity="0.2" />
          <path d="M6.64 12.24L12 15.16V9.84z" fillOpacity="0.6" />
        </g>
      </svg>
    );
  }
  // USDC
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="token-icon"
    >
      <circle cx="12" cy="12" r="12" fill="#2775CA" />
      <text
        x="12"
        y="16.4"
        textAnchor="middle"
        fontSize="13"
        fontWeight="700"
        fontFamily="var(--font-sans, system-ui, sans-serif)"
        fill="#fff"
      >
        $
      </text>
    </svg>
  );
}

/**
 * Uniswap-style token picker. The visible token follows the active route; the
 * menu lists every bridgeable token and selecting one switches to its route.
 */
export function TokenSelect({
  provider,
  onSelectProvider,
}: {
  provider: BridgeProvider;
  onSelectProvider: (provider: BridgeProvider) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const active = TOKENS.find((t) => t.provider === provider) ?? TOKENS[0];

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="token-select" ref={rootRef}>
      <button
        type="button"
        className={`token-select-trigger ${open ? "open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${active.symbol} — change token`}
        onClick={() => setOpen((o) => !o)}
      >
        <TokenIcon symbol={active.symbol} />
        <span className="token-select-symbol">{active.symbol}</span>
        <ChevronDown className="token-select-caret" size={15} aria-hidden="true" />
      </button>
      {open ? (
        <div className="token-select-menu" role="listbox" aria-label="Token">
          {TOKENS.map((token) => {
            const selected = token.provider === provider;
            return (
              <button
                key={token.symbol}
                type="button"
                role="option"
                aria-selected={selected}
                className={`token-option ${selected ? "selected" : ""}`}
                onClick={() => {
                  onSelectProvider(token.provider);
                  setOpen(false);
                }}
              >
                <TokenIcon symbol={token.symbol} size={28} />
                <span className="token-option-text">
                  <strong>{token.symbol}</strong>
                  <small>
                    {token.name} · via{" "}
                    {token.provider === "epoch" ? "Epoch" : "Agglayer"}
                  </small>
                </span>
                {selected ? (
                  <Check
                    className="token-option-check"
                    size={16}
                    aria-hidden="true"
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
