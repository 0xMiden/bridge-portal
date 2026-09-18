import { test, expect } from "../../fixtures/bridge";
import type { Mode, Route } from "../../pages/bridge-page";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

const cells: Array<{
  route: Route;
  mode: Mode;
  provider: "agglayer" | "epoch";
  showBalance: boolean;
}> = [
  { route: "Epoch", mode: "Receive", provider: "epoch", showBalance: false },
  { route: "Epoch", mode: "Send", provider: "epoch", showBalance: false },
  { route: "AggLayer", mode: "Receive", provider: "agglayer", showBalance: false },
  { route: "AggLayer", mode: "Send", provider: "agglayer", showBalance: true },
];

function activityHash(row: Record<string, unknown>): string {
  for (const key of ["sourceTxHash", "midenTxId", "txHash"] as const) {
    const value = row[key];
    if (typeof value === "string" && value.startsWith("0x")) return value;
  }
  return "";
}

for (const cell of cells) {
  test(`${cell.route} ${cell.mode}: confirm creates an activity with a real tx hash`, async ({
    bridge,
  }) => {
    await test.step("wallets ready", () => bridge.waitForReady());
    await test.step("select route + direction", async () => {
      await bridge.setRoute(cell.route);
      await bridge.setMode(cell.mode);
    });
    if (cell.showBalance) {
      await test.step("show Miden balance so AggLayer send can resolve the faucet", () =>
        bridge.showMidenBalance());
    }
    await test.step("amount + confirm", async () => {
      await bridge.fillAmount("0.01");
      await bridge.submit();
    });
    await test.step("lands on activity with a non-UUID hash", async () => {
      await bridge.waitForActivityPage();
      const activities = await bridge.readActivities();
      expect(activities.length).toBeGreaterThan(0);
      const row = activities[0]!;
      expect(row.provider).toBe(cell.provider);
      expect(row.mode).toBe(cell.mode.toLowerCase());
      const hash = activityHash(row);
      expect(hash).toMatch(TX_HASH);
      expect(hash).not.toMatch(UUID);
    });
  });
}
