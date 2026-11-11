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
  if (!withdrawal.enabled) return null;
  if (withdrawal.failed) return (
    <Card>
      <FormAlert>Could not check the Fast withdrawal status for {symbol}.</FormAlert>
      <Button variant="secondary" type="button" disabled={disabled} onClick={() => withdrawal.refresh()}>Retry withdrawal check</Button>
    </Card>
  );
  if (!withdrawal.active) return null;
  return (
    <Card className="space-y-3">
      <p className="text-sm">Withdrawal is active for {symbol} on this chain. Disable withdrawal to use Fast bridge-in again. This cancels the withdrawal countdown and keeps your tokens in The Compact.</p>
      <Button variant="secondary" type="button" disabled={disabled || withdrawal.pending} onClick={onDisable}>
        {withdrawal.pending ? "Disabling withdrawal…" : "Disable withdrawal to bridge again"}
      </Button>
      {withdrawal.error ? <FormAlert>{withdrawal.error}</FormAlert> : null}
    </Card>
  );
}
