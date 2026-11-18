/** Limit the display precision of a decimal token balance without rounding. */
export function compactTokenAmount(value: string) {
  const [whole, fraction = ""] = value.split(".");
  const compactFraction = fraction.slice(0, 4).replace(/0+$/, "");
  if (whole === "0" && !compactFraction && /[1-9]/.test(fraction)) return "<0.0001";
  return compactFraction ? `${whole}.${compactFraction}` : whole;
}
