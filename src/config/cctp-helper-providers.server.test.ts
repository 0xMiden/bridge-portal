import { afterEach, describe, expect, it, vi } from "vitest";
import { helperServer, helperServerSchema } from "./cctp-helper.server";
import { evmHelperServer, evmHelperServerSchema } from "./cctp-evm-helper.server";
import { resolveHelperProvider } from "./cctp-helper-providers.server";
import { manualApi } from "../bridge/providers/xreserve/helper-manual.server";

vi.mock("server-only", () => ({}));
const { tracked } = vi.hoisted(() => ({ tracked: {
  deploymentId: "synthetic-solana-manual-browser-v1", solanaRpc: "https://source.invalid/tracked",
  arcRpc: "https://arc.invalid/tracked", irisApi: "https://iris-api-sandbox.circle.com",
  simulationCaller: "0x8888888888888888888888888888888888888888",
} }));
vi.mock("./cctp-helper-server.json", () => ({ default: [tracked] }));
vi.mock("./cctp-helper-public.json", async () => {
  const { default: rows } = await import("../bridge/providers/xreserve/fixtures/manual/deployment.json");
  return { default: [rows[0], { ...rows[0], deploymentId: "disabled-fixture", enabled: false }] };
});
afterEach(() => vi.unstubAllEnvs());
const variable = "CCTP_HELPER_SERVERS_JSON";
const deployment = { deploymentId: tracked.deploymentId, environment: "testnet" as const };
const privateRow = { ...tracked, solanaRpc: "https://source.invalid/private-sentinel?key=secret-sentinel" };
const configure = (value: unknown) => vi.stubEnv(variable, JSON.stringify(value));

describe("request-time private helper providers", () => {
  it("uses tracked rows only when the variable is absent and reads each request afresh", () => {
    vi.stubEnv(variable, undefined);
    expect(helperServer(tracked.deploymentId).server).toEqual(tracked);
    configure([privateRow]);
    expect(helperServer(tracked.deploymentId, true).server).toEqual(privateRow);
    configure([{ ...privateRow, arcRpc: "https://arc.invalid/new-secret" }]);
    expect(helperServer(tracked.deploymentId).server.arcRpc).toBe("https://arc.invalid/new-secret");
  });
  it("replaces rather than merges or falls back to tracked rows", () => {
    configure([]);
    expect(() => helperServer(tracked.deploymentId)).toThrow(variable);
    configure([{ ...privateRow, deploymentId: "another-id" }]);
    expect(() => helperServer(tracked.deploymentId)).toThrow(variable);
  });
  it("retains disabled historical access but refuses new admission and unknown identities", () => {
    configure([{ ...privateRow, deploymentId: "disabled-fixture" }]);
    expect(helperServer("disabled-fixture").deployment.enabled).toBe(false);
    expect(() => helperServer("disabled-fixture", true)).toThrow("not configured");
    configure([{ ...privateRow, deploymentId: "caller-selected" }]);
    expect(() => helperServer("caller-selected")).toThrow("not configured");
    vi.stubEnv("CCTP_EVM_HELPER_SERVERS_JSON", JSON.stringify([{ ...privateRow, sourceRpc: privateRow.solanaRpc }]));
    expect(() => evmHelperServer("caller-selected")).toThrow("no qualified");
  });
  it.each(["", " ", "{secret-sentinel", "null", "{}", '"secret-sentinel"', "x".repeat(65_537)])(
    "sanitizes malformed, empty or oversized private input %#", raw => {
      vi.stubEnv(variable, raw);
      try { helperServer(tracked.deploymentId); throw new Error("Expected configuration failure"); }
      catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe(`Configure ${variable} server-side with one valid provider row for the selected qualified deployment.`);
        expect((error as Error).cause).toBeUndefined();
      }
    },
  );
  it.each([
    [privateRow, privateRow], [{ ...privateRow, extra: "secret-sentinel" }],
    [{ ...privateRow, simulationCaller: "0x0000000000000000000000000000000000000000" }],
    [{ ...privateRow, solanaRpc: "http://remote.invalid/secret-sentinel" }],
    [{ ...privateRow, arcRpc: "https://user:secret-sentinel@arc.invalid" }],
    [{ ...privateRow, irisApi: "https://iris-api.circle.com" }],
    [{ ...privateRow, irisApi: "https://iris-api-sandbox.circle.com.attacker.invalid" }],
  ].map(rows => ({ rows })))("rejects invalid rows without retaining rejected values %#", ({ rows }) => {
    configure(rows);
    expect(() => helperServer(tracked.deploymentId)).toThrow(variable);
  });
  it("keeps errors and API responses free of provider secrets", async () => {
    configure([{ ...privateRow, arcRpc: "not-a-url/secret-sentinel" }]);
    const log = vi.spyOn(console, "error");
    const response = await manualApi(async () => helperServer(tracked.deploymentId));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ reason: "route_unavailable" });
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
  it("preserves loopback-only HTTP fixtures and official environment origins", () => {
    configure([{ ...privateRow, solanaRpc: "http://127.0.0.1:1234", irisApi: "http://[::1]:1235" }]);
    expect(helperServer(tracked.deploymentId).server.irisApi).toBe("http://[::1]:1235");
    const mainnet = { ...deployment, environment: "mainnet" as const };
    vi.stubEnv(variable, undefined);
    expect(() => resolveHelperProvider(variable, [tracked], helperServerSchema, mainnet)).toThrow(variable);
    expect(resolveHelperProvider(variable, [{ ...tracked, irisApi: "https://iris-api.circle.com" }], helperServerSchema, mainnet).irisApi)
      .toBe("https://iris-api.circle.com");
  });
  it("uses the same strict replacement rules for EVM source providers", () => {
    const { solanaRpc, ...rest } = privateRow;
    const row = { ...rest, sourceRpc: solanaRpc };
    vi.stubEnv("CCTP_EVM_HELPER_SERVERS_JSON", JSON.stringify([row]));
    expect(resolveHelperProvider("CCTP_EVM_HELPER_SERVERS_JSON", [], evmHelperServerSchema, deployment)).toEqual(row);
    vi.stubEnv("CCTP_EVM_HELPER_SERVERS_JSON", JSON.stringify([{ ...row, solanaRpc }]));
    expect(() => resolveHelperProvider("CCTP_EVM_HELPER_SERVERS_JSON", [row], evmHelperServerSchema, deployment)).toThrow("CCTP_EVM_HELPER_SERVERS_JSON");
  });
  it("resolves private rows through the actual EVM server adapter after trusted selection", async () => {
    const config = await import("./cctp-evm-helper");
    const { evmDeployment } = await import("../bridge/providers/xreserve/fixtures/evm/test-fixture");
    const selected = vi.spyOn(config, "getEvmHelperDeployment").mockReturnValue(evmDeployment);
    try {
      const { solanaRpc, ...rest } = privateRow;
      const row = { ...rest, deploymentId: evmDeployment.deploymentId, sourceRpc: solanaRpc };
      vi.stubEnv("CCTP_EVM_HELPER_SERVERS_JSON", JSON.stringify([row]));
      expect(evmHelperServer(evmDeployment.deploymentId, true).server).toEqual(row);
      expect(selected).toHaveBeenCalledWith(evmDeployment.deploymentId, true);
    } finally { selected.mockRestore(); }
  });
});
