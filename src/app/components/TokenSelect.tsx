"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { bridgeRoutes, type BridgeRoute } from "../../bridge/core/routes";
import { networkLabels, providers, tokenNames } from "../lib/bridge-presentation";

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
 * Select a bridgeable token while keeping the chosen external chain.
 */
export function TokenSelect({
  route,
  side,
  onSelectRoute,
}: {
  route: BridgeRoute;
  side: "source" | "destination";
  onSelectRoute: (route: BridgeRoute) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const active = route[side];
  const externalSide = route.mode === "receive" ? "source" : "destination";
  const options = bridgeRoutes.filter((option) => !providers[option.provider].disabled && option.mode === route.mode &&
    option[externalSide].network === route[externalSide].network);

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

  if (options.length < 2) {
    return (
      <div className="token-select" ref={rootRef}>
        <span className="token-select-value">
          <TokenIcon symbol={active.symbol} />
          <span className="token-select-symbol">{active.symbol}</span>
        </span>
      </div>
    );
  }

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
          {options.map((option) => {
            const token = option[side];
            const selected = option.id === route.id;
            return (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={selected}
                className={`token-option ${selected ? "selected" : ""}`}
                onClick={() => {
                  onSelectRoute(option);
                  setOpen(false);
                }}
              >
                <TokenIcon symbol={token.symbol} size={28} />
                <span className="token-option-text">
                  <strong>{token.symbol}</strong>
                  <small>
                    {networkLabels[token.network]} · {option.provider === "xreserve" && token.kind !== "miden" ? "Circle USDC" : tokenNames[token.symbol] ?? token.symbol} · via{" "}
                    {providers[option.provider].label}
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
