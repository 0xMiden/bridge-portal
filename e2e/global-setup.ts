import { getEnvironmentConfig, isMockRun } from "./config/environments";
import { ensureSepoliaEth, mintUsdc, testEvmAddress } from "./driver/evm";
import { makeMidenCli } from "./driver/miden-cli";

// Playwright globalSetup: fund-to-a-floor before the suite (§3.3 / "mint fresh
// each run"). Mock runs skip all of it. Real runs top up Sepolia ETH, mint fresh
// USDC (public mint — no depletion), and prime the Miden client store.
export default async function globalSetup(): Promise<void> {
  const env = getEnvironmentConfig();
  if (isMockRun()) {
    console.log("[e2e] mock network — skipping on-chain funding");
    return;
  }

  console.log(`[e2e] funding for ${env.name} (EVM ${testEvmAddress()})`);
  await ensureSepoliaEth();
  await mintUsdc();
  console.log("[e2e] Sepolia ETH ok, USDC minted");

  const miden = makeMidenCli();
  await miden.init();
  await miden.sync();
  const midenAccountId = process.env.NEXT_PUBLIC_E2E_MIDEN_ACCOUNT_ID;
  if (midenAccountId) {
    await miden.fundAccount(midenAccountId).catch((e) => {
      console.warn("[e2e] Miden faucet funding skipped:", (e as Error).message);
    });
  }
  console.log("[e2e] Miden client primed");
}
