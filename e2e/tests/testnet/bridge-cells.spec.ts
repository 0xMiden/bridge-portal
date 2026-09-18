import { test, expect } from "../../fixtures/bridge";
import type { Mode, Route } from "../../pages/bridge-page";

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;

const cells: Array<{
  route: Route;
  mode: Mode;
  provider: "agglayer" | "epoch";
  needsAccountFile: boolean;
  showBalance: boolean;
}> = [
  { route: "Epoch", mode: "Receive", provider: "epoch", needsAccountFile: false, showBalance: false },
  { route: "AggLayer", mode: "Receive", provider: "agglayer", needsAccountFile: false, showBalance: false },
  { route: "Epoch", mode: "Send", provider: "epoch", needsAccountFile: true, showBalance: false },
  { route: "AggLayer", mode: "Send", provider: "agglayer", needsAccountFile: true, showBalance: true },
];

function activityHash(row: Record<string, unknown>): string {
  for (const key of ["sourceTxHash", "midenTxId", "txHash"] as const) {
    const value = row[key];
    if (typeof value === "string" && value.startsWith("0x")) return value;
  }
  return "";
}

for (const cell of cells) {
  test(`${cell.route} ${cell.mode}: live testnet confirm records a hash`, async ({
    bridge,
  }) => {
    test.skip(
      cell.needsAccountFile && !process.env.E2E_MIDEN_ACCOUNT_FILE,
      "E2E_MIDEN_ACCOUNT_FILE is required for Send specs (exported private account file, hex).",
    );

    await test.step("wallets ready", () => bridge.waitForReady());
    await test.step("select route + direction", async () => {
      await bridge.setRoute(cell.route);
      await bridge.setMode(cell.mode);
    });
    if (cell.showBalance) {
      await test.step("show Miden balance", () => bridge.showMidenBalance());
    }
    await test.step("amount + confirm", async () => {
      await bridge.fillAmount("0.01");
      await bridge.submit();
    });
    await test.step("activity has a 32-byte hash, not a UUID", async () => {
      await bridge.waitForActivityPage(180_000);
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
