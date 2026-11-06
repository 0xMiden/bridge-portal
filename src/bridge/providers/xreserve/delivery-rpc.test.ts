import { afterEach, expect, it, vi } from "vitest";
import { browserMidenSdk } from "../../../../test/miden-sdk";
import { midenLimitsResponse, midenNoteResponse, requestedMidenNote } from "../../../../e2e/helper/miden-note";
import { checkArcDelivery, deriveArcNoteId } from "./delivery";
import { currentBridgeConfig } from "../../../config/bridge-config";

vi.mock("@miden-sdk/miden-sdk", async () => browserMidenSdk());
afterEach(() => vi.unstubAllGlobals());
const intent = { amount: "999990", sender: "0x1111111111111111111111111111111111111111", recipient: "0x4e6fb40fd2f6a55140df2c42dfb5b7",
  faucet: currentBridgeConfig("testnet").derived.usdcxFaucetId, nonce: `0x${"ab".repeat(32)}` };
it("uses the real WASM note owner and exact gRPC ID, not another note for the same recipient", async () => {
  const sdk = await import("@miden-sdk/miden-sdk");
  const expected = deriveArcNoteId(intent, sdk);
  let unrelated = true;
  const requested: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: Request | string, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (new URL(request.url).pathname.endsWith("GetLimits")) return new Response(midenLimitsResponse(), { headers: { "content-type": "application/grpc-web+proto", "grpc-status": "0" } });
    expect(new URL(request.url).pathname).toContain("GetNotesById");
    const id = requestedMidenNote(Buffer.from(await request.arrayBuffer())); requested.push(id);
    return new Response(midenNoteResponse(unrelated ? `0x${"01".repeat(32)}` : id, intent.faucet), { headers: { "content-type": "application/grpc-web+proto", "grpc-status": "0" } });
  }));
  await expect(checkArcDelivery(intent)).rejects.toThrow("node returned note");
  unrelated = false;
  expect(await checkArcDelivery(intent)).toEqual({ noteId: expected, block: 42 });
  expect(requested).toEqual([expected, expected]);
});
