import { expect, it } from "vitest";
import { unstable_readConfig } from "wrangler";

it("enables client disconnect notifications on the deployed Worker", () => {
  const config = unstable_readConfig({ config: "wrangler.jsonc" });
  const flags = config.compatibility_flags ?? [];
  // Cloudflare enables inbound Request.signal by default starting on this compatibility date.
  const enabledByDate = (config.compatibility_date ?? "") >= "2026-11-17";
  expect(flags.includes("enable_request_signal") || enabledByDate).toBe(true);
  expect(flags).not.toContain("disable_request_signal");
});
