import { afterEach, expect, it, vi } from "vitest";
import { evmRpcUrls, evmServerTransport } from "./rpc.server";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("keeps Sepolia override priority, ignores blanks and deduplicates fallbacks", () => {
  vi.stubEnv("AGGLAYER_SEPOLIA_RPC_URL", " https://primary.example ");
  vi.stubEnv("EVM_RPC_URL", "https://secondary.example");
  vi.stubEnv("NEXT_PUBLIC_SEPOLIA_RPC_URL", "https://secondary.example");
  expect(evmRpcUrls("sepolia")).toEqual([
    "https://primary.example", "https://secondary.example", "https://ethereum-sepolia-rpc.publicnode.com",
  ]);
  vi.stubEnv("AGGLAYER_SEPOLIA_RPC_URL", "  ");
  expect(evmRpcUrls("sepolia")[0]).toBe("https://secondary.example");
  vi.stubEnv("EVM_RPC_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SEPOLIA_RPC_URL", "");
  expect(evmRpcUrls("sepolia")).toEqual(["https://ethereum-sepolia-rpc.publicnode.com"]);
});

it("preserves pending receipts and contract errors through the server's viem transport", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ jsonrpc: "2.0", id: 1, result: null }))
    .mockResolvedValueOnce(Response.json({ jsonrpc: "2.0", id: 1, error: { code: 3, message: "execution reverted", data: "0x1234" } }));
  vi.stubGlobal("fetch", fetch);
  const transport = evmServerTransport("arc-testnet")({});
  await expect(transport.request({ method: "eth_getTransactionReceipt", params: ["0xabc"] })).resolves.toBeNull();
  await expect(transport.request({ method: "eth_call", params: [] })).rejects.toMatchObject({ cause: { code: 3, data: "0x1234" } });
  expect(fetch).toHaveBeenCalledTimes(2);
});
