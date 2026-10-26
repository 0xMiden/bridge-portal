"use client";

import { EmptyState, FormAlert } from "./ui/Feedback";

import { useRef } from "react";
import { routesForEnvironment } from "../../bridge/core/routes";
import { bridgeProviders } from "../../bridge/providers/registry";
import type { BridgeEnvironment } from "../../config/environment";
import { errorMessage } from "../lib/wallet-errors";
import { useBridgeEnvironment } from "./NetworkProvider";
import { BridgeTabs } from "./bridge/BridgeTabs";
import { SwapPanels } from "./bridge/SwapPanels";
import { TransferReview } from "./bridge/TransferReview";
import { TransferRouteCard } from "./bridge/TransferRouteCard";
import { useBridgeDraft, type DraftAction } from "./bridge/use-bridge-draft";
import { useBridgeTransfer } from "./bridge/use-bridge-transfer";
import { useBridgeWallets } from "./bridge/use-bridge-wallets";

export function BridgeExperience() {
  const environment = useBridgeEnvironment();
  if (!routesForEnvironment(environment).some(route => !route.disabled && !bridgeProviders[route.provider].disabled)) {
    return (
      <EmptyState>
        <h2>No routes available</h2>
        <p>New transfers are currently unavailable on {environment}. Existing receipts remain accessible from their saved links.</p>
      </EmptyState>
    );
  }
  return <BridgeForm key={environment} environment={environment} />;
}

function BridgeForm({ environment }: { environment: BridgeEnvironment }) {
  const { draft, dispatch } = useBridgeDraft(environment);
  const wallets = useBridgeWallets(draft.route);
  const transfer = useBridgeTransfer(draft, wallets, environment);
  const panelsRef = useRef<HTMLDivElement>(null);

  function editDraft(action: DraftAction) {
    dispatch(action);
    if (action.type !== "route-menu") transfer.clearError();
  }

  function connectMiden() {
    const button = panelsRef.current?.querySelector<HTMLButtonElement>('[data-wallet="miden"] .wallet-pill');
    button?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    button?.focus();
    button?.click();
  }

  function handlePrimaryAction() {
    switch (transfer.cta.action) {
      case "connect-source":
        if (draft.route.mode === "receive") void wallets.openEvmWallet();
        else connectMiden();
        break;
      case "connect-destination":
        if (draft.route.mode === "receive") connectMiden();
        else void wallets.openEvmWallet();
        break;
      case "review":
        transfer.openReview();
        break;
    }
  }

  return (
    <>
      {wallets.miden.error ? <FormAlert className="topbar-error max-w-295" role="alert">{errorMessage(wallets.miden.error)}</FormAlert> : null}
      <section className="swap-stage mx-auto mt-6 flex w-full max-w-137 flex-col items-center gap-4 pb-10 mobile:mt-4">
          <h1 className="sr-only">Miden Bridge</h1>
          <BridgeTabs environment={environment}>
            <SwapPanels draft={draft} wallets={wallets} transfer={transfer} panelsRef={panelsRef} onChange={editDraft} />
            <TransferRouteCard draft={draft} transfer={transfer} onChange={editDraft} onPrimaryAction={handlePrimaryAction}>
              {transfer.review ? (
                <TransferReview review={transfer.review} quote={transfer.quote} walletsChanged={transfer.walletsChanged}
                  onCancel={transfer.cancelReview} onConfirm={transfer.confirmReview} />
              ) : null}
            </TransferRouteCard>
          </BridgeTabs>
      </section>
    </>
  );
}
