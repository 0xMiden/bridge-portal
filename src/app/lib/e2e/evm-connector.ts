import { createConnector } from "@wagmi/core";
import { sepolia } from "@reown/appkit/networks";
import {
  createPublicClient,
  createWalletClient,
  http,
  numberToHex,
  type EIP1193Provider,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { AGGLAYER_BALI } from "../agglayer";
import {
  E2E_EVM_PRIVATE_KEY,
  E2E_MOCK_EVM_ADDRESS,
  UserRejectedError,
  e2eSignerMode,
} from "./env";

const CHAIN_ID = 11155111; // Sepolia
const RPC_URL = AGGLAYER_BALI.sepoliaRpcUrl;

type Rpc = { method: string; params?: unknown[] };

/**
 * A headless EIP-1193 provider that stands in for MetaMask in E2E mode. In
 * `testnet` mode it signs real Sepolia transactions locally with the test key;
 * in `mock` mode it needs no key and returns a canned hash (the network is
 * MSW-stubbed). `reject` signer mode throws a 4001 so specs can exercise the
 * cancel path. Reads always go to a viem public client (intercepted by MSW in
 * mock mode).
 */
function createE2EEvmProvider(): EIP1193Provider {
  const account = E2E_EVM_PRIVATE_KEY
    ? privateKeyToAccount(E2E_EVM_PRIVATE_KEY)
    : undefined;
  const address = (account?.address ?? E2E_MOCK_EVM_ADDRESS) as `0x${string}`;

  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(RPC_URL),
  });
  const walletClient = account
    ? createWalletClient({ account, chain: sepolia, transport: http(RPC_URL) })
    : undefined;

  const signingBlocked = () => e2eSignerMode() === "reject";

  async function request({ method, params = [] }: Rpc): Promise<unknown> {
    switch (method) {
      case "eth_requestAccounts":
      case "eth_accounts":
        return [address];
      case "eth_chainId":
        return numberToHex(CHAIN_ID);
      case "net_version":
        return String(CHAIN_ID);
      // No-op chain switches — we're pinned to Sepolia.
      case "wallet_switchEthereumChain":
      case "wallet_addEthereumChain":
        return null;
      // Report no atomic-batch capability so the Epoch SDK takes the sequential
      // eth_sendTransaction path this provider actually signs.
      case "wallet_getCapabilities":
        return {};
      case "eth_sendTransaction": {
        if (signingBlocked()) throw new UserRejectedError();
        const tx = (params[0] ?? {}) as Record<string, unknown>;
        if (walletClient) {
          return walletClient.sendTransaction({
            to: tx.to as `0x${string}` | undefined,
            data: tx.data as `0x${string}` | undefined,
            value: tx.value ? BigInt(tx.value as string) : undefined,
            gas: tx.gas ? BigInt(tx.gas as string) : undefined,
          });
        }
        // mock tier: deterministic fake hash
        return `0x${"ab".repeat(32)}`;
      }
      case "personal_sign": {
        if (signingBlocked()) throw new UserRejectedError();
        if (!walletClient) return `0x${"00".repeat(65)}`;
        return walletClient.signMessage({
          message: { raw: params[0] as `0x${string}` },
        });
      }
      case "eth_signTypedData_v4": {
        if (signingBlocked()) throw new UserRejectedError();
        if (!walletClient) return `0x${"00".repeat(65)}`;
        const typed =
          typeof params[1] === "string" ? JSON.parse(params[1]) : params[1];
        return walletClient.signTypedData(typed);
      }
      default:
        return publicClient.request({ method, params } as never);
    }
  }

  // Minimal EIP-1193 surface (request + inert event methods).
  return {
    request: request as EIP1193Provider["request"],
    on: () => {},
    removeListener: () => {},
  } as unknown as EIP1193Provider;
}

/**
 * wagmi connector wrapping the headless provider so Reown AppKit / wagmi hooks
 * (`useAppKitAccount`, `useAppKitProvider("eip155")`) resolve to the test
 * wallet after `E2EAutoConnect` connects it. Only registered when E2E is on.
 */
export function e2eEvmConnector() {
  const provider = createE2EEvmProvider();
  let connected = false;

  return createConnector((config) => ({
    id: "e2e-injected",
    name: "E2E Test Wallet",
    type: "e2e" as const,
    async connect() {
      connected = true;
      const accounts = (await provider.request({
        method: "eth_accounts",
      })) as `0x${string}`[];
      return { accounts, chainId: CHAIN_ID } as never;
    },
    async disconnect() {
      connected = false;
    },
    async getAccounts() {
      return (await provider.request({
        method: "eth_accounts",
      })) as readonly `0x${string}`[];
    },
    async getChainId() {
      return CHAIN_ID;
    },
    async getProvider() {
      return provider;
    },
    async isAuthorized() {
      // In E2E we always want a fresh explicit connect via E2EAutoConnect.
      return connected;
    },
    onAccountsChanged() {},
    onChainChanged() {},
    onDisconnect() {
      connected = false;
      config.emitter.emit("disconnect");
    },
  }));
}
