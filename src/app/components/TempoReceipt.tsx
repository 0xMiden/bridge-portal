"use client";

import Image from "next/image";
import { ArrowRight, Check, Copy } from "lucide-react";
import { useState } from "react";
import {
  type Activity,
  modes,
  providers,
  shortAddress,
} from "../lib/bridge-state";

type Link = { available: boolean; href?: string; label?: string } | null;

const TOKEN_DOT: Record<string, string> = {
  USDC: "#2775CA",
  ETH: "#627EEA",
};

function two(n: number) {
  return String(n).padStart(2, "0");
}

/**
 * A settled bridge transfer rendered as a printed-receipt — monospace, dashed
 * tear-lines, a numbered line item, totals, and explorer actions. Styled after
 * the Tempo explorer receipt, in the Miden design system.
 */
export function TempoReceipt({
  activity,
  received,
  networkFee,
  sourceLink,
  destinationLink,
  transactionHash,
}: {
  activity: Activity;
  received: string;
  networkFee: string;
  sourceLink: Link;
  destinationLink: Link;
  transactionHash: string;
}) {
  const [copied, setCopied] = useState(false);
  const route = providers[activity.provider]?.label ?? activity.provider;
  const mode = modes[activity.mode];
  const dot = TOKEN_DOT[activity.asset] ?? "var(--muted-foreground)";
  const primaryLink = sourceLink?.href ?? destinationLink?.href;

  const d = new Date(activity.updatedAt);
  const date = `${two(d.getMonth() + 1)}/${two(d.getDate())}/${d.getFullYear()}`;
  const time = `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;

  const copyHash = async () => {
    try {
      await navigator.clipboard.writeText(transactionHash || activity.txHash);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — no-op */
    }
  };

  const Token = ({ symbol }: { symbol: string }) => (
    <span className="rcpt-token">
      <i style={{ background: TOKEN_DOT[symbol] ?? "var(--muted-foreground)" }} />
      {symbol}
    </span>
  );

  return (
    <article className="rcpt-paper" aria-label="Transfer receipt">
      <header className="rcpt-head">
        <Image
          className="rcpt-logo"
          src="/miden-logo-horizontal.svg"
          alt="Miden"
          width={92}
          height={28}
        />
        <dl className="rcpt-meta">
          <div>
            <dt>Route</dt>
            <dd>{route}</dd>
          </div>
          <div>
            <dt>Type</dt>
            <dd>{activity.mode === "send" ? "Bridge out" : "Bridge in"}</dd>
          </div>
          <div>
            <dt>Date</dt>
            <dd>{date}</dd>
          </div>
          <div>
            <dt>Time</dt>
            <dd>{time}</dd>
          </div>
          <div>
            <dt>Hash</dt>
            <dd className="rcpt-hash">{shortAddress(transactionHash || activity.txHash)}</dd>
          </div>
        </dl>
      </header>

      <div className="rcpt-tear" aria-hidden="true" />

      <div className="rcpt-item">
        <div className="rcpt-item-line">
          <span className="rcpt-num">1.</span>
          <span className="rcpt-tag">Bridge</span>
          <span className="rcpt-amt">
            {activity.amount} <Token symbol={activity.asset} />
          </span>
          <ArrowRight className="rcpt-arrow" size={14} aria-hidden="true" />
          <span className="rcpt-amt">
            {received.replace(/[^\d.]/g, "") || received} <Token symbol={activity.asset} />
          </span>
        </div>
        <div className="rcpt-item-sub">
          <span>{mode.from}</span>
          <ArrowRight size={12} aria-hidden="true" />
          <span>{mode.to}</span>
        </div>
        {activity.destination ? (
          <div className="rcpt-item-to">
            to <span>{shortAddress(activity.destination)}</span>
          </div>
        ) : null}
      </div>

      <div className="rcpt-tear" aria-hidden="true" />

      <dl className="rcpt-totals">
        <div>
          <dt>ETA</dt>
          <dd>{activity.eta}</dd>
        </div>
        <div>
          <dt>Received</dt>
          <dd>{received}</dd>
        </div>
        <div>
          <dt>Network fee</dt>
          <dd>{networkFee}</dd>
        </div>
      </dl>

      <div className="rcpt-actions">
        <button type="button" onClick={copyHash}>
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          {copied ? "Copied" : "Copy hash"}
        </button>
        {sourceLink?.href ? (
          <a href={sourceLink.href} target="_blank" rel="noopener noreferrer">
            Etherscan
          </a>
        ) : null}
        {destinationLink?.href ? (
          <a href={destinationLink.href} target="_blank" rel="noopener noreferrer">
            Midenscan
          </a>
        ) : null}
      </div>

      {primaryLink ? (
        <a
          className="rcpt-view"
          href={primaryLink}
          target="_blank"
          rel="noopener noreferrer"
        >
          View transaction <ArrowRight size={14} aria-hidden="true" />
        </a>
      ) : null}
    </article>
  );
}
