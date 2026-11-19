import { BitcoinAdapter } from "@reown/appkit-adapter-bitcoin";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

async function discover(id: string, request: (method: string) => Promise<object>) {
  vi.stubGlobal("window", Object.assign(new EventTarget(), {
    btc_providers: [{ id, name: id, icon: "" }],
    [id]: { request },
  }));
  const adapter = new BitcoinAdapter();
  await adapter.syncConnectors();
  return adapter.connectors.find(connector => connector.id === id)!;
}

it("reads Leather's current native SegWit payment account at each funding check", async () => {
  let payment = "bc1q530dz4h80kwlzywlhx2qn0k6vdtftd93c499yq";
  const ordinal = "bc1putuzj9lyfcm8fef9jpy85nmh33cxuq9u6wyuk536t9kemdk37yjqmkc0pg";
  const leather = await discover("LeatherProvider", async method => {
    expect(method).toBe("getAddresses");
    return { result: { addresses: [
      { symbol: "STX", address: "STX account" },
      { symbol: "BTC", type: "p2tr", address: ordinal },
      { symbol: "BTC", type: "p2wpkh", address: payment },
    ] } };
  });
  expect(await leather.getAccountAddresses()).toMatchObject([
    { purpose: "payment", address: payment }, { purpose: "ordinal", address: ordinal },
  ]);
  payment = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
  expect((await leather.getAccountAddresses())[0]).toMatchObject({ purpose: "payment", address: payment });
});

it("preserves the meaning of Sats Connect's explicit payment refusal", async () => {
  const sats = await discover("SatsProvider", async () => ({
    error: { code: -32000, message: "Request canceled" },
  }));
  await expect(sats.sendTransfer({ recipient: "1BoatSLRHtKNngkdXEeobR76b53LETtpyT", amount: "1000" }))
    .rejects.toMatchObject({ code: 4001 });
});
