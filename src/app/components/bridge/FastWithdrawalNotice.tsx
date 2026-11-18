import { AlertTriangle } from "lucide-react";
import type { FastWithdrawal } from "./use-fast-withdrawal";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { FormAlert } from "../ui/Feedback";

export function FastWithdrawalNotice({ withdrawal, symbol, disabled, onDisable }: {
  withdrawal: FastWithdrawal;
  symbol: string;
  disabled: boolean;
  onDisable: () => Promise<void>;
}) {
  if (!withdrawal.active) return null;
  return (
    <Card className="grid gap-3">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-warning-soft text-warning-foreground">
          <AlertTriangle size={17} aria-hidden="true" />
        </span>
        <div className="grid gap-0.5">
          <h2 className="text-sm font-semibold">Withdrawal active for {symbol}</h2>
          <p className="text-sm text-muted-foreground">Fast deposits are paused. Canceling keeps your funds locked.</p>
        </div>
      </div>
      <Button variant="secondary" className="w-fit" type="button" disabled={disabled || withdrawal.pending} onClick={onDisable}>
        {withdrawal.pending ? "Canceling withdrawal…" : "Cancel withdrawal"}
      </Button>
      {withdrawal.error ? <FormAlert className="mt-0!">{withdrawal.error}</FormAlert> : null}
    </Card>
  );
}
