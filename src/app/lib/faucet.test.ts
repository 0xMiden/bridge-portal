import { describe, expect, it } from "vitest";
import { AGGLAYER_BALI } from "./agglayer";
import { type EvmProvider } from "./evm-wallet";
import { FAUCET_SEPOLIA_USDC, mintSepoliaUsdc, sepoliaTxUrl } from "./faucet";

// Records the calls a mint makes so we can assert the encoded transaction.
function fakeProvider(): {
  provider: EvmProvider;
  calls: Array<{ method: string; params?: unknown }>;
} {
  const calls: Array<{ method: string; params?: unknown }> = [];
  const provider: EvmProvider = {
    async request<T>({ method, params }: { method: string; params?: unknown[] }) {
      calls.push({ method, params });
      // Report Sepolia so ensureSepolia doesn't try to switch networks.
      if (method === "eth_chainId") return AGGLAYER_BALI.sepoliaChainHex as T;
      if (method === "eth_sendTransaction") return "0xdeadbeef" as T;
      return undefined as T;
    },
  };
  return { provider, calls };
}

describe("mintSepoliaUsdc", () => {
  it("sends mint() to the USDC token with the recipient + amount encoded", async () => {
    const { provider, calls } = fakeProvider();
    const account = "0x00000000000000000000000000000000000000ab";

    const hash = await mintSepoliaUsdc({ provider, account, amount: "1000" });

    expect(hash).toBe("0xdeadbeef");
    const send = calls.find((c) => c.method === "eth_sendTransaction");
    expect(send).toBeDefined();
    const tx = (send!.params as Array<Record<string, string>>)[0];
    expect(tx.to.toLowerCase()).toBe(FAUCET_SEPOLIA_USDC.address.toLowerCase());
    expect(tx.from).toBe(account);
    // mint(address,uint256) selector.
    expect(tx.data.startsWith("0x40c10f19")).toBe(true);
    // recipient in the first arg word, 1000 * 10^18 in the second.
    expect(tx.data.toLowerCase()).toContain(account.slice(2).toLowerCase());
    expect(tx.data.toLowerCase()).toContain(
      (1000n * 10n ** 18n).toString(16),
    );
  });

  it("switches the wallet to Sepolia before minting when on another chain", async () => {
    const { provider, calls } = fakeProvider();
    // Override eth_chainId to a non-Sepolia value for this case.
    const base = provider.request.bind(provider);
    provider.request = (async ({ method, params }) => {
      if (method === "eth_chainId") {
        calls.push({ method, params });
        return "0x1";
      }
      return base({ method, params });
    }) as EvmProvider["request"];

    await mintSepoliaUsdc({
      provider,
      account: "0x00000000000000000000000000000000000000ab",
    });

    expect(calls.some((c) => c.method === "wallet_switchEthereumChain")).toBe(true);
  });
});

describe("sepoliaTxUrl", () => {
  it("builds an explorer tx link without a double slash", () => {
    expect(sepoliaTxUrl("0xabc")).toBe(
      `${AGGLAYER_BALI.sepoliaExplorer.replace(/\/$/, "")}/tx/0xabc`,
    );
  });
});
