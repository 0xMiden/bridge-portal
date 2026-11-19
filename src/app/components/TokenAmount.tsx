import { formatTokenAmount } from "../lib/token-amount";

export function TokenAmount({ amount, symbol, roundDown = false }: {
  amount: string;
  symbol?: string;
  roundDown?: boolean;
}) {
  const displayed = formatTokenAmount(amount, roundDown);
  const unit = symbol ? ` ${symbol}` : "";
  return <span title={displayed !== amount ? `${amount}${unit}` : undefined}>{displayed}{unit}</span>;
}
