import { describe, expect, it, vi } from "vitest";

import {
  PUBLICNODE_SEPOLIA_RPC,
  sepoliaRpc,
  sepoliaRpcUrl,
} from "./sepolia-rpc";

describe("sepoliaRpcUrl", () => {
  it("prefers AGGLAYER_SEPOLIA_RPC_URL, then EVM_RPC_URL, then publicnode", () => {
    expect(
      sepoliaRpcUrl({
        AGGLAYER_SEPOLIA_RPC_URL: "https://primary.example",
        EVM_RPC_URL: "https://secondary.example",
      }),
    ).toBe("https://primary.example");
    expect(sepoliaRpcUrl({ EVM_RPC_URL: "https://secondary.example" })).toBe(
      "https://secondary.example",
    );
    expect(sepoliaRpcUrl({})).toBe(PUBLICNODE_SEPOLIA_RPC);
  });

  it("treats blank env values as unset", () => {
    expect(
      sepoliaRpcUrl({
        AGGLAYER_SEPOLIA_RPC_URL: "  ",
        EVM_RPC_URL: "https://secondary.example",
      }),
    ).toBe("https://secondary.example");
  });
});

describe("sepoliaRpc", () => {
  it("POSTs json-rpc to the resolved URL and returns result", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ result: "0x1" }), { status: 200 }),
    ) as unknown as typeof fetch;

    const result = await sepoliaRpc<string>(
      "eth_chainId",
      [],
      fetchImpl,
      { AGGLAYER_SEPOLIA_RPC_URL: "https://primary.example" },
    );

    expect(result).toBe("0x1");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(url).toBe("https://primary.example");
    expect(JSON.parse(String(init.body))).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_chainId",
      params: [],
    });
  });

  it("throws on HTTP 5xx and on json-rpc error objects", async () => {
    const httpFail = vi.fn(async () => new Response("nope", { status: 502 })) as unknown as typeof fetch;
    await expect(sepoliaRpc("eth_chainId", [], httpFail, {})).rejects.toThrow(
      "Sepolia RPC returned 502.",
    );

    const rpcFail = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: "rate limited" } }), {
        status: 200,
      }),
    ) as unknown as typeof fetch;
    await expect(sepoliaRpc("eth_chainId", [], rpcFail, {})).rejects.toThrow(
      "rate limited",
    );
  });
});
