import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fetchWithdrawalQuote } from "./withdrawal-quote";

const request = {
  network: "arc-testnet", amount: "2", sender: "0x4e6fb40fd2f6a55140df2c42dfb5b7",
  recipient: "0xaabbccddeeff0011223344556677889900112233",
};
const quote = { ...request, fee: "16400", received: "1983600", expiresAt: 1792664000000 };

beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(1792663940000));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("accepts a current withdrawal estimate with equivalent decimal and account formatting", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
    ...quote, amount: "2.000000", sender: request.sender.toUpperCase().replace("0X", "0x"),
  })));
  const estimate = await fetchWithdrawalQuote(request);
  expect(estimate.fee).toBe("16400");
  expect(estimate.received).toBe("1983600");
  expect(estimate.expiresAt).toBe(1792664000000);
});

it.each([
  { name: "network", changed: { network: "base-sepolia" }, error: /route changed/ },
  { name: "deployment", changed: { deploymentId: "different" }, error: /route changed/ },
  { name: "amount", changed: { amount: "3" }, error: /amount changed/ },
  { name: "sender", changed: { sender: "0x179f749ee2329e317d96fe3ed5aaf9" }, error: /accounts changed/ },
  { name: "recipient", changed: { recipient: `0x${"ab".repeat(20)}` }, error: /accounts changed/ },
  { name: "fee conservation", changed: { fee: "16401" }, error: /does not match the amount/ },
  { name: "numeric fee", changed: { fee: 16400 }, error: /invalid withdrawal estimate/ },
  { name: "expiry", changed: { expiresAt: 1792663940000 }, error: /expired/ },
])("rejects a returned estimate with invalid $name", async ({ changed, error }) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ...quote, ...changed })));
  await expect(fetchWithdrawalQuote(request)).rejects.toThrow(error);
});
