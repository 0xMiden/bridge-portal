import { afterEach, expect, it, vi } from "vitest";
import { currentDeployment } from "../../../config/deployments";
import { requestCircleQuote, type CctpQuoteRequest } from "./cctp-quote";

const input: CctpQuoteRequest = {
  network: "ethereum", deploymentId: currentDeployment("mainnet").id,
  sender: "0x1111111111111111111111111111111111111111",
  recipient: "0x4e6fb40fd2f6a55140df2c42dfb5b7", amount: "100",
};
// Metadata captured from the mainnet Ethereum → Arc quote API on 2026-10-22.
// The signed payload is a placeholder; signature verification belongs to the contract.
const response = {
  signedQuote: "0x01020304", issuedAt: 1792663778,
  expiry: { mode: "BLOCK_NUMBER", expiresAtBlock: 26247476, blockEstimatedAt: 1792663946 },
  feeTotalAmount: "27713", burnAmount: "100000000",
  feeToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
};

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([
  { expiry: response.expiry, estimate: 1792663946_000 },
  { expiry: { mode: "TIMESTAMP", expiresAt: 1792663946 }, estimate: 1792663946_000 },
  { expiry: { mode: "BLOCK_NUMBER", expiresAtBlock: 26247476 }, estimate: 1792663778_000 },
  { expiry: { ...response.expiry, blockEstimatedAt: 1792663777 }, estimate: 1792663777_000 },
])("preserves $expiry.mode expiry independently of the local clock", async ({ expiry, estimate }) => {
  vi.spyOn(Date, "now").mockReturnValue(1792667546_000);
  const fetch = vi.fn().mockResolvedValue(Response.json({ ...response, expiry }));
  vi.stubGlobal("fetch", fetch);
  const quote = await requestCircleQuote(input);
  expect(quote).toEqual({
    ...input, signedQuote: "0x01020304", fee: "27713", issuedAt: 1792663778,
    expiry, expiresAt: estimate,
  });
  expect(fetch.mock.calls[0][0]).toBe("https://iris-api.circle.com/v2/quote/burn/usdc/0/26");
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
    amount: "100000000", feeToken: response.feeToken,
    requests: [{ type: "PRE_FINALITY" }, { type: "FORWARD", params: {
      destinationCaller: "0x000000000000000000000000Fa7be2f04F3Ad4ca969260729c6d45B5625984A7",
    } }],
  });
});

it.each([
  { expiry: { blockEstimatedAt: 1792663946 } },
  { expiry: { mode: "UNKNOWN", expiresAt: 1792663946 } },
  { expiry: { mode: "BLOCK_NUMBER", blockEstimatedAt: 1792663946 } },
  { expiry: { ...response.expiry, expiresAtBlock: 1.5 } },
  { expiry: { ...response.expiry, expiresAtBlock: Number.MAX_SAFE_INTEGER + 1 } },
  { expiry: { ...response.expiry, blockEstimatedAt: "1792663946" } },
  { expiry: { mode: "TIMESTAMP", expiresAt: response.issuedAt } },
  { expiry: { mode: "TIMESTAMP", expiresAt: Number.MAX_SAFE_INTEGER } },
  { issuedAt: undefined },
  { issuedAt: -1 },
])("rejects invalid Circle expiry metadata: %j", async (invalid) => {
  // Keep the old wall-clock check satisfied, so rejection must come from metadata.
  vi.spyOn(Date, "now").mockReturnValue(response.issuedAt * 1000);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ...response, ...invalid })));
  await expect(requestCircleQuote(input)).rejects.toThrow("invalid");
});
