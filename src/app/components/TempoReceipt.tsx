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

/** Human duration between the two legs, e.g. "12m", "1m 30s", "45s", "1h 5m". */
function formatDuration(ms: number) {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return sec ? `${min}m ${sec}s` : `${min}m`;
  const hr = Math.floor(min / 60);
  const rem = min % 60;
  return rem ? `${hr}h ${rem}m` : `${hr}h`;
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
  sourceHash,
  destinationHash,
  sourceTxAt,
  destinationTxAt,
  status,
  pending = false,
}: {
  activity: Activity;
  received: string;
  networkFee: string;
  sourceLink: Link;
  destinationLink: Link;
  sourceHash?: string;
  destinationHash?: string;
  sourceTxAt?: number;
  destinationTxAt?: number;
  status?: { label: string; tone: string };
  pending?: boolean;
}) {
  const route = providers[activity.provider]?.label ?? activity.provider;
  const mode = modes[activity.mode];
  // Once both legs have landed, the real duration replaces the ETA estimate.
  const timeTook =
    sourceTxAt && destinationTxAt && destinationTxAt >= sourceTxAt
      ? formatDuration(destinationTxAt - sourceTxAt)
      : null;
  const hashCell = (h?: string) => (h ? shortAddress(h) : "Pending");
  // A leg with no tx yet reads "—" (em dash), not a fabricated time.
  const timeCell = (ms?: number) => {
    if (!ms) return "—";
    const d = new Date(ms);
    return `${two(d.getMonth() + 1)}/${two(d.getDate())}/${d.getFullYear()} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
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
          {/* A bridge transfer is two transactions — one per chain — so each leg
              carries its own hash and time (source first, then destination). */}
          <div>
            <dt>{mode.from} tx</dt>
            <dd className="rcpt-hash">{hashCell(sourceHash)}</dd>
          </div>
          <div>
            <dt>{mode.from} time</dt>
            <dd>{timeCell(sourceTxAt)}</dd>
          </div>
          <div>
            <dt>{mode.to} tx</dt>
            <dd className="rcpt-hash">{hashCell(destinationHash)}</dd>
          </div>
          <div>
            <dt>{mode.to} time</dt>
            <dd>{timeCell(destinationTxAt)}</dd>
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
          <dt>{timeTook ? "Time it took" : "ETA"}</dt>
          <dd>{timeTook ?? activity.eta}</dd>
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
