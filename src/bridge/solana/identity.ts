const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Bounded canonical base58 identity check; byte length is not a character-count heuristic. */
export function isSolanaBytes(value: string, byteLength: number): boolean {
  if (!value || value.length > 90) return false;
  let number = 0n;
  for (const character of value) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) return false;
    number = number * 58n + BigInt(digit);
  }
  const leading = value.length - value.replace(/^1+/, "").length;
  let remaining = number, count = 0;
  while (remaining) { count++; remaining >>= 8n; }
  if (leading + count !== byteLength) return false;
  let encoded = "";
  while (number) { encoded = alphabet[Number(number % 58n)] + encoded; number /= 58n; }
  return "1".repeat(leading) + encoded === value;
}
