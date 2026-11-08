import { formatUnits, parseUnits } from "viem";

/** Display precision only: keep four fractional digits, or four significant
 * digits for small amounts. Never change the quote or wallet's exact units. */
export function formatTokenAmount(value: string, roundDown = false): string {
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(value);
  if (!match) return value;
  const [, whole, fraction = ""] = match;
  const decimals = whole === "0" ? Math.max(4, fraction.search(/[1-9]/) + 4) : 4;
  const displayInput = roundDown && fraction.length > decimals
    ? `${whole}.${fraction.slice(0, decimals)}` : value;
  return formatUnits(parseUnits(displayInput, decimals), decimals);
}
