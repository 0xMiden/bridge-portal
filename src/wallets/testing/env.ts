// Shared gate + config for the E2E test-mode injection layer. Everything here is
// dead code in normal builds: `isE2E()` is false unless NEXT_PUBLIC_E2E_TEST is
// exactly "true", so the injected signers/connectors are never constructed.
//
// The private key / seed are read from NEXT_PUBLIC_* because the injected
// signers run in the browser. That is acceptable ONLY because these are
// throwaway funded testnet accounts and the values are present solely in an
// E2E build (the flag is off — and the vars absent — in production).

export function isE2E(): boolean {
  return process.env.NEXT_PUBLIC_E2E_TEST === "true";
}

/** "testnet" (real chains) or "mock" (MSW-stubbed network). */
export function e2eNetwork(): "testnet" | "mock" {
  return process.env.NEXT_PUBLIC_E2E_NETWORK === "mock" ? "mock" : "testnet";
}

/**
 * "sign" (default) or "reject" — lets a spec force a 4001 wallet rejection.
 * Checked at call time so a single build can toggle it: a spec sets
 * localStorage "e2e-signer-mode" before submitting; the build-time env is the
 * fallback default.
 */
export function e2eSignerMode(): "sign" | "reject" {
  if (typeof window !== "undefined") {
    try {
      const runtime = window.localStorage.getItem("e2e-signer-mode");
      if (runtime === "reject" || runtime === "sign") return runtime;
    } catch {
      // ignore storage access errors
    }
  }
  return process.env.NEXT_PUBLIC_E2E_SIGNER_MODE === "reject" ? "reject" : "sign";
}

export const E2E_EVM_PRIVATE_KEY = process.env
  .NEXT_PUBLIC_E2E_EVM_PRIVATE_KEY as `0x${string}` | undefined;

export const E2E_MIDEN_SEED = process.env.NEXT_PUBLIC_E2E_MIDEN_SEED;

/** A stable, non-signing placeholder address for the mock tier (no key needed). */
export const E2E_MOCK_EVM_ADDRESS =
  "0xE2E0000000000000000000000000000000000001" as `0x${string}`;

export class UserRejectedError extends Error {
  code = 4001;
  constructor() {
    super("User rejected the request.");
    this.name = "UserRejectedError";
  }
}
