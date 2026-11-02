import type { HealthCheckResponse } from "@epoch-protocol/epoch-intents-sdk";

/** Simulated SDK 2.2 service contract, not a claim about deployed API readiness. */
export function epochServiceHealth(compactAddress = "0x00000000000000171ede64904551eedf3c6c9788"): HealthCheckResponse {
  const chains = [1, 137, 4663, 8453, 42161, 11155111, 999999999];
  return {
    status: "healthy",
    allocatorAddresses: Object.fromEntries(chains.map(id => [id, "0xC7a2E29b7ef4543a3e7c50057d83beDfCdE2fb0C"])),
    arbiterAddresses: Object.fromEntries(chains.map(id => [id, "0xff065285a18c4608901004788540bb83a2e29ad8"])),
    compactAddresses: Object.fromEntries(chains.map(id => [id, compactAddress])),
    midenVirtualChainId: 999999999,
    midenTestnetVirtualChainId: 999999999,
    midenMainnetVirtualChainId: 999999999,
    compactLockResetPeriod: 4,
    compactLockScope: 0,
    compactExpirySeconds: 10800,
    compactExpiryBufferSeconds: 600,
    midenRecallBufferBlocks: 1000,
    signingAddress: "0xa9e9d269a36a701f5dff89214a85d97730e2471d",
    timestamp: "2026-10-28T00:00:00.000Z",
    supportedChains: [],
    delegationManagerAddresses: {},
    metamaskStateless7702Implementations: {},
    epochLegacy7702Implementations: {},
    gaslessSupportedChainIds: [],
    approveResetTokens: {},
  };
}

/** Mainnet currently publishes bridge configuration without gasless metadata. */
export function epochWalletPaidHealth(compactAddress?: string): Partial<HealthCheckResponse> {
  const health: Partial<HealthCheckResponse> = epochServiceHealth(compactAddress);
  for (const key of ["delegationManagerAddresses", "metamaskStateless7702Implementations",
    "epochLegacy7702Implementations", "gaslessSupportedChainIds", "approveResetTokens"] as const) delete health[key];
  return health;
}
