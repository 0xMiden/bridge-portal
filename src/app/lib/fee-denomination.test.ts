import { expect, test, vi } from "vitest";
import { routesForEnvironment } from "../../bridge/core/routes";
import { activityDetailFor } from "./activity-detail-presentation";
import { createActivity, providerFee, quoteFor } from "./bridge-presentation";
import { authorization, event, signedFixture } from "../../bridge/providers/xreserve/fixtures/manual/test-fixture";

vi.mock("../../config/cctp-helper-public.json", async () => ({ default: (await import("../../bridge/providers/xreserve/fixtures/manual/deployment.json")).default }));

test("the manual receipt and shared quote formatter retain the same USDC cap and USDCx output", async () => {
  const route = routesForEnvironment("testnet").find(value => value.transport === "cctp-helper")!;
  const auth = { ...authorization(), maxCctpFee: "10", minimumNet: "999990" };
  const signed = await signedFixture(auth);
  const activity = createActivity(route, "1", { cctpHelper: {
    schemaVersion: 1, execution: "manual", authorization: auth, attemptId: "fee-denomination", stage: "needs_attention",
    eventAccount: event.publicKey.toBase58(), scanStartSlot: "100", blockhash: signed.transaction.recentBlockhash!, lastValidBlockHeight: "200",
    signature: signed.signature, sourceFeeLamports: "10000", eventRentLamports: "4315200",
  } });
  const receipt = activityDetailFor(activity).receipt;
  expect(receipt.fee).toEqual({ label: "Maximum CCTP fee", value: "0.00001 USDC" });
  expect(receipt.activity.cctpHelper?.authorization.maxCctpFee).toBe("10");
  expect(receipt.receivedAmount).toBe("0.99999");
  const quote = quoteFor(route, "1");
  expect(quote.asset).toBe("USDCx"); expect(quote.fees.charging).toBe("deducted");
  // useBridgeQuote supplies these actual source/destination symbols to the shared formatter.
  expect(providerFee(quote.fees, "0.00001", route.source.symbol, route.destination.symbol)).toEqual(receipt.fee);
});

test("ordinary deducted withdrawal fees retain destination USDC in receipt and quote formatting", () => {
  const route = routesForEnvironment("testnet").find(value => value.provider === "xreserve" && value.mode === "send")!;
  expect(route.source.symbol).toBe("USDCx"); expect(route.destination.symbol).toBe("USDC");
  const activity = createActivity(route, "1", { xreserveNoteId: "withdrawal-note", xreserveWithdrawalFeeEstimate: "10", xreserveWithdrawalReceivedEstimate: "999990" });
  const receipt = activityDetailFor(activity).receipt, quote = quoteFor(route, "1");
  expect(quote.fees.charging).toBe("deducted"); expect(quote.fees.denomination).toBeUndefined();
  expect(receipt.fee).toEqual({ label: "Estimated Circle fee", value: "0.00001 USDC (estimated)" });
  expect(providerFee(quote.fees, "0.00001", route.source.symbol, route.destination.symbol)).toEqual(receipt.fee);
  expect(receipt.receivedAmount).toBe("0.99999");
});
