import { expect, it } from "vitest";
import { formatTokenAmount } from "./token-amount";

it.each([
  ["0.001959990508755621", "0.00196", "0.001959"],
  ["4.986106", "4.9861", "4.9861"],
  ["0.000085349999", "0.00008535", "0.00008534"],
  ["0.000000000000000001", "0.000000000000000001", "0.000000000000000001"],
  ["9007199254740993.99999", "9007199254740994", "9007199254740993.9999"],
  ["0.99999999", "1", "0.9999"],
  ["1.2300000", "1.23", "1.23"],
  ["0.0000000", "0", "0"],
  ["—", "—", "—"],
  ["…", "…", "…"],
])("formats %s without losing tiny amounts, integer precision or the minimum bound", (amount, display, minimum) => {
  expect(formatTokenAmount(amount)).toBe(display);
  expect(formatTokenAmount(amount, true)).toBe(minimum);
});
