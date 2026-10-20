"use client";

import { ExternalLink } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { activityRoute } from "../../bridge/core/routes";
import { bridgeProviders } from "../../bridge/providers/registry";
import { shortAddress } from "../../wallets/identity";
import type { ActivityDetailModel } from "../lib/activity-detail-presentation";
import { destinationAssetSymbol, modes, networkLabels } from "../lib/bridge-presentation";
import { useSepoliaGasEstimate } from "../lib/sepolia-gas";
import { FiatAmount } from "./FiatAmount";
import { NetworkLogo } from "./AssetLogo";

type Receipt = ActivityDetailModel["receipt"];

function Address({ label, value }: { label: string; value?: string }) {
  const [status, setStatus] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  useEffect(() => {
    if (status !== "copied" && status !== "failed") return;
    const timer = window.setTimeout(() => setStatus("idle"), 2_000);
    return () => window.clearTimeout(timer);
  }, [status]);

  async function copy() {
    if (!value) return;
    setStatus("copying");
    try {
      await navigator.clipboard.writeText(value);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
  }

  return <div className="journey-address"><span>{label} </span>{value ? (
    <button type="button" aria-label={`Copy ${label.toLowerCase()} address`} title={value} disabled={status === "copying"} onClick={copy}>
      <span className={status === "copied" || status === "failed" ? "journey-copy-hidden" : undefined}>{shortAddress(value)}</span>
      <span className="journey-copy-feedback" role="status">{status === "copied" ? "Copied" : status === "failed" ? "Copy failed" : ""}</span>
    </button>
  ) : <span>Not recorded</span>}</div>;
}

function Reference({ label, hash, link, at }: {
  label: string; hash?: string; link: Receipt["sourceLink"]; at?: number;
}) {
  return <div className="journey-reference">
    <dt title={label}>{label}</dt>
    <dd>
      {at ? <time dateTime={new Date(at).toISOString()} title={new Date(at).toLocaleString()}>
        <span className="journey-reference-date">{new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}<span aria-hidden="true"> · </span></span>
        {new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })}
      </time> : null}
      {link?.available && link.href ? (
        <a href={link.href} target="_blank" rel="noopener noreferrer" aria-label={link.label} title={hash}>
          {hash ? shortAddress(hash) : "Explorer"}<ExternalLink size={12} aria-hidden="true" />
        </a>
      ) : <span title={hash}>{hash ? shortAddress(hash) : "Pending"}</span>}
    </dd>
  </div>;
}

export function ActivityJourney({ receipt, needsClaim, children }: {
  receipt: Receipt; needsClaim: boolean; children: ReactNode;
}) {
  const { activity } = receipt;
  const route = activityRoute(activity);
  const from = route ? networkLabels[route.source.network] : modes[activity.mode].from;
  const to = route ? networkLabels[route.destination.network] : modes[activity.mode].to;
  const sourceAddress = activity.mode === "send" ? activity.midenAccount
    : activity.sourceTransaction?.from ?? activity.evmAddress ?? activity.epochSponsor;
  const destinationAsset = destinationAssetSymbol(activity);
  const differentOutput = destinationAsset !== activity.asset || Number(receipt.receivedAmount) !== Number(activity.amount);
  const evmAsset = route?.source.kind === "miden" ? route.destination : route?.source;
  const gas = useSepoliaGasEstimate(receipt.sepoliaGasUnits, evmAsset?.kind !== "miden" ? evmAsset?.network : undefined);
  const networkFee = gas.fee ?? (gas.loading ? "Estimating…" : receipt.networkFee);
  const status = needsClaim ? { label: "Ready to claim", tone: "active" }
    : receipt.status ?? { label: "Complete", tone: "success" };
  const elapsed = receipt.sourceTxAt && receipt.destinationTxAt && receipt.destinationTxAt > receipt.sourceTxAt
    ? Math.round((receipt.destinationTxAt - receipt.sourceTxAt) / 1000) : null;
  const duration = elapsed === null ? "—" : elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m${elapsed % 60 ? ` ${elapsed % 60}s` : ""}`;

  return <article className="journey-paper" aria-label="Transfer receipt">
    <header className="journey-heading">
      <h1>{activity.amount} {activity.asset} <FiatAmount amount={activity.amount} symbol={activity.asset} /></h1>
      <span className={`rcpt-status ${status.tone}`}>{status.label}</span>
    </header>
    <div className="journey-route">
      <div className="journey-endpoint">
        <div className="journey-chain">{route && <NetworkLogo network={route.source.network} />}<strong>{from}</strong></div>
        <Address label="From" value={sourceAddress} />
      </div>
      <span className="journey-connection" aria-hidden="true" />
      <div className="journey-endpoint">
        <div className="journey-chain">{route && <NetworkLogo network={route.destination.network} />}<strong>{to}</strong></div>
        <Address label="To" value={activity.destination} />
      </div>
    </div>
    {children}
    <dl className="journey-details" aria-label="Fees and details">
      <div><dt>Provider</dt><dd>{bridgeProviders[activity.provider].label}</dd></div>
      {receipt.tracked && <div><dt>{receipt.pending ? "Estimated total time" : "Delivery time"}</dt><dd>{receipt.pending ? activity.eta : duration}</dd></div>}
      {differentOutput && <div><dt>{receipt.receivedLabel}</dt><dd>{receipt.receivedAmount} {destinationAsset}</dd></div>}
      <div><dt>Network fee · estimated</dt><dd>{networkFee}</dd></div>
      <div><dt>{receipt.fee?.label ?? "Provider fee"}</dt><dd>{receipt.fee?.value ?? "Unavailable"}</dd></div>
      <Reference label={`${from} tx`} hash={receipt.sourceHash} link={receipt.sourceLink} at={receipt.sourceTxAt} />
      {(receipt.tracked || receipt.destinationHash) && <Reference label={`${to} ${receipt.destinationKind}`} hash={receipt.destinationHash} link={receipt.destinationLink} at={receipt.destinationTxAt} />}
    </dl>
  </article>;
}
