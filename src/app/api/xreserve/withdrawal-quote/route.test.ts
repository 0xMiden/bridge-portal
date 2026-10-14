import { afterEach, expect, it, vi } from "vitest";
import { POST } from "./route";
const input = {
  network: "arc-testnet", amount: "2", sender: "0x4e6fb40fd2f6a55140df2c42dfb5b7",
  recipient: "0x1122334455667788990011223344556677889900",
};
// Relevant fields from Circle sandbox prepare-withdrawal, 2026-10-14.
const intent = {
  maxFee: "16400", spec: {
    version: 1, sourceDomain: 26, destinationDomain: 26,
    destinationToken: "0x0000000000000000000000003600000000000000000000000000000000000000",
    destinationRecipient: "0x0000000000000000000000001122334455667788990011223344556677889900",
    value: "1983600", hookData: {
      remoteDomain: 10007,
      remoteDepositor: "0x000000000000000000000000000000004e6fb40fd2f6a55140df2c42dfb5b700",
      remoteToken: "0x000000000000000000000000000000004cbdcaffe75f0a317482224dae643600",
      forwardingContractAddress: "0x0000000000000000000000000000000000000000", forwardingCalldata: "0x",
    },
  },
};
const request = () => new Request("http://localhost/api/xreserve/withdrawal-quote", { method: "POST", body: JSON.stringify(input) });
afterEach(() => vi.unstubAllGlobals());
it("returns Circle's net payout and fee without signing or submitting its prepared intent", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ batches: [{ burnIntents: [intent] }] }));
  vi.stubGlobal("fetch", fetch);
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ...input, fee: "16400", received: "1983600" });
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0][0]).toBe("https://xreserve-api-testnet.circle.com/v1/prepare-withdrawal");
  expect(JSON.parse(fetch.mock.calls[0][1].body).batches[0]).toMatchObject({
    remoteDepositor: intent.spec.hookData.remoteDepositor, valueIncludingFees: "2", finalDestinationDomain: 26,
  });
});
it.each([
  { ...intent, maxFee: "16401" },
  { ...intent, spec: { ...intent.spec, destinationDomain: 0 } },
  { ...intent, spec: { ...intent.spec, destinationRecipient: "0x" + "00".repeat(32) } },
  { ...intent, spec: { ...intent.spec, hookData: { ...intent.spec.hookData, forwardingCalldata: "0x1234" } } },
])("refuses mismatched or unsupported payout terms", async (bad) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ batches: [{ burnIntents: [bad] }] })));
  expect((await POST(request())).status).toBe(502);
});
it("does not turn an upstream outage into a zero-fee quote", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Unavailable", { status: 503 })));
  const response = await POST(request());
  expect(response.status).toBe(502);
  expect(await response.json()).not.toHaveProperty("fee");
});
