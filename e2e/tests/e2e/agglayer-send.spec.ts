import { test, expect } from "../../fixtures/bridge";

// Real Miden -> Sepolia AggLayer send (B2AGG bridge-out note). Requires the
// funded Miden testnet signer. Exercises the least-validated path (the direct
// @miden-sdk signer) — expect to confirm the signer during first live run.
test.skip(
  !process.env.E2E_MIDEN_SEED,
  "requires a funded Miden testnet signer (E2E_MIDEN_SEED)",
);

test("agglayer send builds + submits a B2AGG note", async ({ bridge, steps }) => {
  await steps.step("wallets ready", () => bridge.waitForReady());

  await steps.step("configure AggLayer send", async () => {
    await bridge.setRoute("AggLayer");
    await bridge.setMode("Send");
    await bridge.fillAmount("0.0001");
    // Destination Sepolia address defaults to the connected EVM wallet.
  });

  await steps.step("submit -> Miden note tx recorded", async () => {
    await bridge.submit();
    await bridge.openActivity();
    const activity = ((await bridge.readActivities())[0] ?? {}) as Record<
      string,
      unknown
    >;
    expect(activity.midenTxId).toBeTruthy();
    expect(activity.mode).toBe("send");
    expect(activity.provider).toBe("agglayer");
  });
});
