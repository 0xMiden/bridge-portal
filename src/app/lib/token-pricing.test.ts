import { expect, it } from "vitest";
import { formatUsdAmount } from "./token-pricing";

it.each<[string, number | undefined, string | null]>([
  ["2.5", 3200.5, "$8,001.25"],
  ["1000", 0.9998, "$999.80"],
  [".5", 3200.5, "$1,600.25"],
  ["1.005", 1, "$1.01"],
  ["0.000001", 3200.5, "$0.00"],
  ["", undefined, "$0.00"],
  ["0", undefined, "$0.00"],
  ["2", undefined, null],
  ["2", 0, null],
  ["2", Infinity, null],
  ["—", 1, null],
  ["…", 1, null],
  ["-1", 1, null],
  ["1.2.3", 1, null],
  ["1e3", 1, null],
  ["0xff", 1, null],
  ["9".repeat(309), 1, null],
])("formats %s tokens at %s USD without inventing unavailable values", (amount, price, expected) => {
  expect(formatUsdAmount(amount, price)).toBe(expected);
});
