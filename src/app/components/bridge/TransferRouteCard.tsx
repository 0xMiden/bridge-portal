import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { Fuel, RefreshCcw } from "lucide-react";
import type { ReactNode } from "react";
import type { BridgeDraft } from "./use-bridge-draft";
import type { BridgeTransfer } from "./use-bridge-transfer";

export function TransferRouteCard({ draft, transfer, onPrimaryAction, children }: {
  draft: BridgeDraft;
  transfer: Pick<BridgeTransfer, "quote" | "cta" | "isSubmitting">;
  onPrimaryAction: () => void;
  children?: ReactNode;
}) {
  const { route } = draft;
  const { quote, cta, isSubmitting } = transfer;

  return (
    <Card plain className="transfer-route-card" data-provider={route.provider} data-has-amount={quote.validation.valid} aria-label="Transfer route">
      <div className="transfer-route-details px-3" hidden={!quote.validation.valid || !quote.live}>
        <dl className="quote-summary text-xs leading-5" aria-label="Route quote">
          <div className="flex items-center justify-between gap-3">
            <dt className="inline-flex shrink-0 items-center gap-1.5 text-muted-foreground"><Fuel size={14} aria-hidden="true" />Network fee</dt>
            <dd className="min-w-0 text-right font-medium tabular-nums wrap-anywhere">{quote.networkFee}</dd>
          </div>
        </dl>
      </div>
      <div className="primary-action-dock mt-3.5 mobile:sticky mobile:top-[calc(100dvh-67px-env(safe-area-inset-bottom))] mobile:z-3 mobile:pb-[env(safe-area-inset-bottom)]">
        <Button variant="bridge" className="primary-button" type="button" onClick={onPrimaryAction}
          disabled={cta.disabled || Boolean(quote.validation.error) || (cta.action === "review" && quote.capBlocked)}>
          {cta.label}
          {isSubmitting ? <RefreshCcw size={18} className="animate-spin" aria-hidden="true" /> : null}
        </Button>
      </div>
      {children}
    </Card>
  );
}
