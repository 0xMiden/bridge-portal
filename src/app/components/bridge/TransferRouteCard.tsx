import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { Fuel, RefreshCcw } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { BridgeDraft } from "./use-bridge-draft";
import type { BridgeTransfer } from "./use-bridge-transfer";

export function TransferRouteCard({ draft, transfer, onPrimaryAction, children }: {
  draft: BridgeDraft;
  transfer: Pick<BridgeTransfer, "quote" | "cta" | "isSubmitting" | "withdrawal">;
  onPrimaryAction: () => void;
  children?: ReactNode;
}) {
  const { route } = draft;
  const { quote, cta, isSubmitting, withdrawal } = transfer;

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
      {cta.action === "review" && quote.validation.valid && withdrawal.failed ? (
        <Link href="/recovery" className="mx-3 inline-flex min-h-11 items-center rounded-sm text-sm font-semibold text-accent-foreground underline underline-offset-3">
          Check withdrawal status in Recovery
        </Link>
      ) : null}
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
