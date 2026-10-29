"use client";

import { Card } from "./ui/Card";
import { DetailsList } from "./ui/DetailsList";
import { StatusIndicator } from "./ui/Status";
import type { BridgeNetwork } from "../../bridge/core/assets";
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

  return <div className="mt-1 text-xs text-muted-foreground wrap-anywhere"><span>{label} </span>{value ? (
    <button className="relative rounded text-left hover:text-foreground hover:underline" type="button" aria-label={`Copy ${label.toLowerCase()} address`} title={value} disabled={status === "copying"} onClick={copy}>
      <span className={status === "copied" || status === "failed" ? "journey-copy-hidden invisible" : undefined}>{shortAddress(value)}</span>
      <span className="journey-copy-feedback absolute inset-0" role="status">{status === "copied" ? "Copied" : status === "failed" ? "Copy failed" : ""}</span>
    </button>
  ) : <span>Not recorded</span>}</div>;
}

function Reference({ label, hash, link, at }: {
  label: string; hash?: string; link: Receipt["sourceLink"]; at?: number;
}) {
  return <div className="flex flex-wrap items-baseline justify-between gap-2">
    <dt className="text-muted-foreground" title={label}>{label}</dt>
    <dd className="ml-auto flex flex-wrap items-center justify-end gap-2">
      {at ? <time className="text-xs text-muted-foreground tabular-nums" dateTime={new Date(at).toISOString()} title={new Date(at).toLocaleString()}>
        <span className="journey-reference-date">{new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}<span aria-hidden="true"> · </span></span>
        {new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })}
      </time> : null}
      {link?.available && link.href ? (
        <a className="inline-flex items-center gap-1.25 underline underline-offset-3" href={link.href} target="_blank" rel="noopener noreferrer" aria-label={link.label} title={hash}>
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
    : activity.solanaAddress ?? activity.sourceTransaction?.from ?? activity.evmAddress ?? activity.epochSponsor;
  const destinationAsset = destinationAssetSymbol(activity);
  const differentOutput = destinationAsset !== activity.asset || Number(receipt.receivedAmount) !== Number(activity.amount);
  const evmAsset = route?.source.kind === "miden" ? route.destination : route?.source;
  const gas = useSepoliaGasEstimate(receipt.sepoliaGasUnits, evmAsset?.kind !== "miden" && evmAsset?.kind !== "spl" ? evmAsset?.network : undefined);
  const networkFee = gas.fee ?? (gas.loading ? "Estimating…" : receipt.networkFee);
  const status = needsClaim ? { label: "Ready to claim", tone: "active" as const }
    : receipt.status ?? { label: "Complete", tone: "success" as const };
  const elapsed = receipt.sourceTxAt && receipt.destinationTxAt && receipt.destinationTxAt > receipt.sourceTxAt
    ? Math.round((receipt.destinationTxAt - receipt.sourceTxAt) / 1000) : null;
  const duration = elapsed === null ? "—" : elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m${elapsed % 60 ? ` ${elapsed % 60}s` : ""}`;

  return <Card as="article" variant="receipt" aria-label="Transfer receipt">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <h1 className="flex min-w-0 flex-wrap items-baseline gap-2 text-3xl font-semibold wrap-anywhere">{activity.amount} {activity.asset} <FiatAmount amount={activity.amount} symbol={activity.asset} size="receipt" /></h1>
      <StatusIndicator tone={status.tone}>{status.label}</StatusIndicator>
    </header>
    <div className="my-5 flex items-start gap-3">
      <JourneyEndpoint network={route?.source.network} name={from} label="From" address={sourceAddress} />
      <span className="mt-4 h-px w-4 shrink-0 bg-border-strong" aria-hidden="true" />
      <JourneyEndpoint network={route?.destination.network} name={to} label="To" address={activity.destination} />
    </div>
    {children}
    <DetailsList layout="receipt" aria-label="Fees and details" items={[
      { label: "Provider", value: bridgeProviders[activity.provider].label },
      receipt.tracked && { label: receipt.pending ? "Estimated total time" : "Delivery time", value: receipt.pending ? activity.eta : duration },
      differentOutput && { label: receipt.receivedLabel, value: `${receipt.receivedAmount} ${destinationAsset}` },
      { label: "Network fee · estimated", value: networkFee },
      { label: receipt.fee?.label ?? "Provider fee", value: receipt.fee?.value ?? "Unavailable" },
    ]}>
      <Reference label={`${from} tx`} hash={receipt.sourceHash} link={receipt.sourceLink} at={receipt.sourceTxAt} />
      {(receipt.tracked || receipt.destinationHash) && <Reference label={`${to} ${receipt.destinationKind}`} hash={receipt.destinationHash} link={receipt.destinationLink} at={receipt.destinationTxAt} />}
    </DetailsList>
  </Card>;
}

function JourneyEndpoint({ network, name, label, address }: {
  network?: BridgeNetwork; name: string; label: string; address?: string;
}) {
  return <div className="min-w-0">
    <div className="flex items-center gap-2">
      {network && <NetworkLogo network={network} variant="endpoint" />}
      <strong className="text-sm font-semibold">{name}</strong>
    </div>
    <Address label={label} value={address} />
  </div>;
}
