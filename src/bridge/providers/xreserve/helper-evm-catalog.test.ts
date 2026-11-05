import { describe, expect, it } from "vitest";
import vectors from "./fixtures/evm/source-vectors.json";
import sources from "../../../config/cctp-evm-sources.json";
import { evmNetworks } from "../../../config/evm-networks";
import { evmHelperDeployments } from "../../../config/cctp-evm-helper";
import { helperDeployments } from "../../../config/cctp-helper";
import { routesForEnvironment } from "../../core/routes";
import { directionFor } from "../registry";
import { evmDeployment } from "./fixtures/evm/test-fixture";
import { evmHelperDeploymentSchema } from "../../../config/cctp-evm-helper";
describe("independently extracted Circle source vectors and release gating", () => {
  it.each(vectors)("pins $name $environment native USDC and source contracts", v => {
    const row = sources.find(row => row.domain === v.domain && row.environment === v.environment)!;
    expect(row).toMatchObject({ chainId: v.chainId, usdc: v.usdc, tokenMessenger: v.tokenMessenger, messageTransmitter: v.messageTransmitter, tokenMinter: v.tokenMinter });
    const chain = evmNetworks[row.network as keyof typeof evmNetworks];
    expect(chain.id).toBe(v.chainId); expect(chain.nativeCurrency.symbol).toBe(v.gas); expect(chain.nativeCurrency.decimals).toBe(v.gasDecimals);
  });
  it("has all24 non-Arc EVM sources per environment but enables none", () => {
    expect(sources).toHaveLength(50); expect(evmHelperDeployments).toEqual([]); expect(helperDeployments).toEqual([]);
    for (const env of ["testnet", "mainnet"] as const) {
      const routes = routesForEnvironment(env).filter(r => r.transport === "cctp-helper-evm");
      expect(routes).toHaveLength(24); expect(routes.every(r => r.disabled && !r.evmHelperDeployment)).toBe(true);
      expect(routes.some(r => ["arc", "arc-testnet"].includes(r.source.network))).toBe(false);
      for (const route of routes) expect(directionFor(route).fees(route).networkFee).toContain(evmNetworks[route.source.network as keyof typeof evmNetworks].nativeCurrency.symbol);
    }
  });
  it("uses manual source phases and fees for persisted EVM helper activities as well as route snapshots", () => {
    const row = { cctpEvmHelper: { stage: "wallet_pending" }, provider: "xreserve", mode: "receive" } as const;
    const direction = directionFor(row);
    expect(direction.tracking).toBe("manual"); expect(direction.resolvePhase(row as unknown as import("../../core/models").BridgeActivity)).toBe("wallet_pending");
    expect(direction.phases.wallet_pending.headline).toBe("Source wallet request saved");
  });
  it.each(["chainId", "domain", "usdc", "tokenMessenger", "messageTransmitter", "tokenMinter"])("rejects deployment %s mismatch rather than ABI-compatible substitution", field => {
    const d = structuredClone(evmDeployment), source = d.source as unknown as Record<string, unknown>;
    source[field] = typeof source[field] === "number" ? 99 : { ...(source[field] as object), address: "0x9999999999999999999999999999999999999999" };
    expect(evmHelperDeploymentSchema.safeParse(d).success).toBe(false);
  });
});
