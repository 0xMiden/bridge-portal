"use client";

import Image from "next/image";
import { ArrowRight } from "lucide-react";
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
 * A chain explorer link that only becomes clickable once that leg's transaction
 * exists (`available`). Before then it renders as a disabled control, so a
 * still-pending destination never links to an unrelated account page.
 */
function ExplorerAction({ link }: { link: Link }) {
  if (!link?.label) return null;
  const label = link.label.replace(/^View on /, "");
  if (link.available && link.href) {
    return (
      <a href={link.href} target="_blank" rel="noopener noreferrer">
        {label}
      </a>
    );
  }
  return (
    <span
      className="rcpt-action-disabled"
      aria-disabled="true"
      title="Available once this transfer lands on that chain"
    >
      {label}
    </span>
  );
}

/**
 * A bridge transfer rendered as a clean receipt card — header meta, a line item
 * with token dots, totals, and the two chain explorer links. Uses the Miden
 * design system (system sans, hairline rules, tabular figures). The same card
 * backs every detail-page state: pass `status` + `pending` for an in-flight or
 * failed transfer (adds a status pill and switches "Received" → "Expected").
 */
export function TempoReceipt({
  activity,
  received,
  networkFee,
  sourceLink,
  destinationLink,
  transactionHash,
  status,
  pending = false,
}: {
  activity: Activity;
  received: string;
  networkFee: string;
  sourceLink: Link;
  destinationLink: Link;
  transactionHash: string;
  status?: { label: string; tone: string };
  pending?: boolean;
}) {
  const route = providers[activity.provider]?.label ?? activity.provider;
  const mode = modes[activity.mode];
  const hash =
    transactionHash || (activity.txHash !== "0x0" ? activity.txHash : "");

  const d = new Date(activity.updatedAt);
  const date = `${two(d.getMonth() + 1)}/${two(d.getDate())}/${d.getFullYear()}`;
  const time = `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;

  const Token = ({ symbol }: { symbol: string }) => (
    <span className="rcpt-token">
      <i style={{ background: TOKEN_DOT[symbol] ?? "var(--muted-foreground)" }} />
      {symbol}
    </span>
  );

  return (
    <article className="rcpt-paper" aria-label="Transfer receipt">
      <header className="rcpt-head">
        <div className="rcpt-head-top">
          <Image
            className="rcpt-logo"
            src="/miden-logo-horizontal.svg"
            alt="Miden"
            width={92}
            height={28}
          />
          {status ? (
            <span className={`rcpt-status ${status.tone}`}>{status.label}</span>
          ) : null}
        </div>
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
            <dd className="rcpt-hash">
              {hash ? shortAddress(hash) : "Pending"}
            </dd>
          </div>
        </dl>
      </header>

      <div className="rcpt-tear" aria-hidden="true" />

      <div className="rcpt-item">
        <div className="rcpt-item-line">
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
          <dt>{pending ? "Expected" : "Received"}</dt>
          <dd>{received}</dd>
        </div>
        <div>
          <dt>Network fee</dt>
          <dd>{networkFee}</dd>
        </div>
      </dl>

      {sourceLink || destinationLink ? (
        <div className="rcpt-actions">
          {/* Each link carries its own chain-correct label + an `available` flag.
              A leg's explorer link is only clickable once that leg's tx exists —
              otherwise it's disabled, so we never send the user to an unrelated
              account page for a transfer that hasn't landed on that chain yet. */}
          <ExplorerAction link={sourceLink} />
          <ExplorerAction link={destinationLink} />
        </div>
      ) : null}
    </article>
  );
}
