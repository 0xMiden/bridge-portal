import { afterEach, expect, it, vi } from "vitest";
import { requestTestnetFaucetNote } from "./miden-faucet";

const api = "https://faucet-api-testnet-miden.eu-central-8.gateway.fm";
const account = "0xa22ec154f9a36d911953fd5c9260a7";

afterEach(() => vi.unstubAllGlobals());

it("requests metadata, PoW and a public note from the faucet API", async () => {
  const challenge = "ab".repeat(120);
  const minted = { tx_id: "tx", note_id: "note" };
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(Response.json({ decimals: 6 }))
    .mockResolvedValueOnce(Response.json({ challenge, target: Number.MAX_SAFE_INTEGER * 2048 }))
    .mockResolvedValueOnce(Response.json(minted));
  vi.stubGlobal("fetch", fetchMock);

  await expect(requestTestnetFaucetNote(account)).resolves.toEqual(minted);
  const urls = fetchMock.mock.calls.map(([url]) => new URL(url));
  expect(urls.map((url) => url.origin)).toEqual([api, api, api]);
  expect(urls.map((url) => url.pathname)).toEqual(["/get_metadata", "/pow", "/get_tokens"]);
  expect(Object.fromEntries(urls[1].searchParams)).toEqual({ account_id: account, amount: "1000000" });
  expect(Object.fromEntries(urls[2].searchParams)).toEqual({
    account_id: account, is_private_note: "false", asset_amount: "1000000", challenge, nonce: "0",
  });
});

it("reports faucet failures before requesting a challenge or mint", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response("rate limited", { status: 429 }));
  vi.stubGlobal("fetch", fetchMock);
  await expect(requestTestnetFaucetNote(account)).rejects.toThrow("faucet 429");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
