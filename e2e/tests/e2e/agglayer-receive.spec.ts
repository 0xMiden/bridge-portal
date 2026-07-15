import { test, expect } from "../../fixtures/bridge";
import { waitForSepoliaTxSuccess } from "../../driver/evm";
import { waitForAgglayerDeposit } from "../../driver/agglayer";

// Real Sepolia -> Miden AggLayer receive: injected EVM wallet signs a real
// bridge deposit. We DETECT THE ACTUAL TRANSACTIONS — confirm the Sepolia
// receipt on-chain and detect the deposit in the AggLayer bridge indexer — not
// just observe an amount change. Full ~30-90 min claim settlement is out of
// scope here.
test.skip(
  !process.env.E2E_EVM_PRIVATE_KEY,
  "requires a funded Sepolia key (E2E_EVM_PRIVATE_KEY)",
);

test("agglayer receive broadcasts a real Sepolia deposit and tracks it", async ({
  bridge,
  steps,
}) => {
  await steps.step("wallets ready", () => bridge.waitForReady());

  await steps.step("configure AggLayer receive (small ETH)", async () => {
    await bridge.setRoute("AggLayer");
    await bridge.setMode("Receive");
    await bridge.fillAmount("0.0001");
  });

  await steps.step("submit -> real deposit broadcasts", async () => {
    await bridge.submit();
    await bridge.openActivity();
  });

  await steps.step("CONFIRM the real Sepolia deposit tx on-chain", async () => {
    const activity = (await bridge.readActivities())[0] as Record<string, unknown>;
    const sourceTxHash = String(activity.sourceTxHash ?? "");
    expect(sourceTxHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    // Real receipt from the Sepolia RPC — the tx actually mined & succeeded.
    expect(await waitForSepoliaTxSuccess(sourceTxHash as `0x${string}`)).toBe(true);
  });

  await steps.step("DETECT the deposit in the AggLayer bridge indexer", async () => {
    const activity = (await bridge.readActivities())[0] as Record<string, unknown>;
    const dest = String(activity.bridgeDestinationAddress ?? "");
    expect(dest).not.toBe("");
    // The bridge actually observed the deposit for this destination.
    const deposit = await waitForAgglayerDeposit(dest, {
      timeoutMs: 300_000,
      intervalMs: 15_000,
    });
    expect(deposit, "AggLayer bridge did not observe the deposit").not.toBeNull();
  });
});
