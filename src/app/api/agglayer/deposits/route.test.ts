import { afterEach, expect, test, vi } from "vitest";
import { GET } from "./route";

afterEach(() => vi.unstubAllGlobals());

test("queries deposits by their EVM bridge destination and rejects the account alias", async () => {
  const address = "0x00000000387149ae66116cf114eebd60bb738100";
  const deposit = { tx_hash: "0xsource", deposit_cnt: 42 };
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ deposits: [deposit] }));
  vi.stubGlobal("fetch", fetcher);

  const response = await GET(new Request(`https://bridge.test/api/agglayer/deposits?destinationAddress=${address}`));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ destinationAddress: address, deposits: [deposit] });
  expect(fetcher.mock.calls[0]?.[0]).toContain(`/bridges/${address}`);

  fetcher.mockClear();
  const invalid = await GET(new Request("https://bridge.test/api/agglayer/deposits?midenAccountId=0x387149ae66116cf114eebd60bb7381"));
  expect(invalid.status).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
});
