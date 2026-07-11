import { test, expect } from "../../fixtures/bridge";

// Real Miden -> Sepolia Epoch send (P2ID collateral note -> USDC out). Requires
// the funded Miden testnet signer.
test.skip(
  !process.env.E2E_MIDEN_SEED,
  "requires a funded Miden testnet signer (E2E_MIDEN_SEED)",
);

test("epoch send mints a collateral note and records the intent", async ({
  bridge,
  steps,
}) => {
  await steps.step("wallets ready", () => bridge.waitForReady());

  await steps.step("configure Epoch send", async () => {
    await bridge.setRoute("Epoch");
    await bridge.setMode("Send");
    await bridge.fillAmount("1");
  });

  await steps.step("submit -> intent recorded", async () => {
    await bridge.submit();
    await bridge.openActivity();
    const activity = ((await bridge.readActivities())[0] ?? {}) as Record<
      string,
      unknown
    >;
    expect(activity.provider).toBe("epoch");
    expect(activity.mode).toBe("send");
    expect(activity.status).not.toBe("signature");
  });
});
