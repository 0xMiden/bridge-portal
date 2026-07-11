import type { MidenFiWalletContextState } from "@miden-sdk/miden-wallet-adapter-react";
import { E2E_MIDEN_SEED, UserRejectedError, e2eNetwork, e2eSignerMode } from "./env";

// The write/read surface the app depends on (a subset of the MidenFi adapter),
// matching MidenWalletSnapshot in MidenWalletButton.tsx.
export interface E2EMidenSigner {
  address: string;
  requestSend: NonNullable<MidenFiWalletContextState["requestSend"]>;
  requestTransaction: NonNullable<MidenFiWalletContextState["requestTransaction"]>;
  waitForTransaction: NonNullable<MidenFiWalletContextState["waitForTransaction"]>;
  requestAssets: NonNullable<MidenFiWalletContextState["requestAssets"]>;
  requestConsumableNotes: NonNullable<
    MidenFiWalletContextState["requestConsumableNotes"]
  >;
}

// A real, checksum-valid Miden testnet address for the mock tier (no signing —
// only the app's bech32 validation must pass). No key/funds are used.
const MOCK_MIDEN_ADDRESS = "mtst1aqk5t00kapdcnq2yyf77dz6xcysswce0_qr7qqq9wr6w";

function rejectIfConfigured() {
  if (e2eSignerMode() === "reject") throw new UserRejectedError();
}

/**
 * Mock-tier Miden signer: no @miden-sdk, no network. Returns canned ids/assets
 * and honors `reject` mode so the cancel spec can exercise the rejection path.
 * Deterministic and dependency-free.
 */
function createMockMidenSigner(): E2EMidenSigner {
  const fakeTxId = `0x${"cd".repeat(32)}`;
  return {
    address: MOCK_MIDEN_ADDRESS,
    requestSend: (async () => {
      rejectIfConfigured();
      return fakeTxId;
    }) as unknown as E2EMidenSigner["requestSend"],
    requestTransaction: (async () => {
      rejectIfConfigured();
      return fakeTxId;
    }) as unknown as E2EMidenSigner["requestTransaction"],
    waitForTransaction: (async () =>
      undefined) as unknown as E2EMidenSigner["waitForTransaction"],
    requestAssets: (async () => []) as unknown as E2EMidenSigner["requestAssets"],
    requestConsumableNotes: (async () =>
      []) as unknown as E2EMidenSigner["requestConsumableNotes"],
  };
}

/**
 * Testnet-tier Miden signer: real signing with @miden-sdk against Miden testnet,
 * seeded from E2E_MIDEN_SEED. This mirrors what the MidenFi adapter does
 * internally (build → prove → submit a TransactionRequest) but with a headless
 * key. It requires a funded Miden testnet account and must be validated against
 * the live network — it is the one piece of the harness that can't be verified
 * without Brian's funded seed. Wired lazily so the WASM SDK only loads in the
 * browser, in E2E builds.
 */
async function createTestnetMidenSigner(): Promise<E2EMidenSigner> {
  if (!E2E_MIDEN_SEED) {
    throw new Error(
      "E2E testnet Miden signer requires NEXT_PUBLIC_E2E_MIDEN_SEED (funded Miden testnet account).",
    );
  }
  // Implemented against @miden-sdk WebClient + the wallet-adapter Transaction
  // types. Kept in a dynamic import so the eager WASM never enters SSR.
  const { createTestnetMidenSignerImpl } = await import("./miden-signer-testnet");
  return createTestnetMidenSignerImpl(E2E_MIDEN_SEED);
}

/** Build the Miden signer for the active E2E network mode. */
export async function createE2EMidenSigner(): Promise<E2EMidenSigner> {
  return e2eNetwork() === "mock"
    ? createMockMidenSigner()
    : createTestnetMidenSigner();
}
