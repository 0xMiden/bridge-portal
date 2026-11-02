import { describe, expect, it } from "vitest";
import { bridgeConfigSchema } from "./schema";
import { assertTokenConnections, tokenConnectionsSchema } from "./token-connections";
import { withPortalEpochRoutes } from "./epoch-mainnet";
import mainnet from "./mainnet.json";
import data from "./token-connections.json";

describe.each(["ethereum:eth", "polygon:pol", "robinhood:usdg"])("Epoch %s verified mapping", route => {
  it.each(["faucet", "source precision", "destination precision", "asset kind"])("rejects a mismatched %s", mismatch => {
    const connections = tokenConnectionsSchema.parse(data).mainnet;
    const pair = connections.find(pair => pair.routes.receive === `mainnet:epoch:${route}:receive`)!;
    if (mismatch === "faucet") pair.miden.faucetId = "0x111111111111111111111111111111";
    if (mismatch === "source precision") pair.evm.decimals -= 1;
    if (mismatch === "destination precision") pair.miden.decimals += 1;
    if (mismatch === "asset kind") pair.evm = pair.evm.kind === "native"
      ? { ...pair.evm, kind: "erc20", address: "0x0000000000000000000000000000000000000000" }
      : { ...pair.evm, kind: "native" };
    expect(() => assertTokenConnections(bridgeConfigSchema.parse(withPortalEpochRoutes(bridgeConfigSchema.parse(mainnet))), connections))
      .toThrow("Epoch token connection does not match verified configuration");
  });
});

it.each(["faucet", "source precision", "destination precision", "source contract"])(
  "rejects a locally added token whose %s differs from the verified deployment",
  mismatch => {
    const connections = tokenConnectionsSchema.parse(data).mainnet;
    const pair = connections.find(pair => pair.provider === "agglayer" && pair.evm.symbol === "USDG")!;
    if (mismatch === "faucet") pair.miden.faucetId = "0x111111111111111111111111111111";
    if (mismatch === "source precision") pair.evm.decimals += 1;
    if (mismatch === "destination precision") pair.miden.decimals -= 1;
    if (mismatch === "source contract" && pair.evm.kind === "erc20") pair.evm.address = "0x1111111111111111111111111111111111111111";
    expect(() => assertTokenConnections(bridgeConfigSchema.parse(withPortalEpochRoutes(bridgeConfigSchema.parse(mainnet))), connections)).toThrow(/does not match verified configuration/);
  },
);

it("rejects a missing configured mainnet token instead of silently narrowing the list", () => {
  const connections = tokenConnectionsSchema.parse(data).mainnet;
  const index = connections.findIndex(pair => pair.provider === "agglayer" && pair.evm.kind === "erc20");
  connections.splice(index, 1);
  expect(() => assertTokenConnections(bridgeConfigSchema.parse(withPortalEpochRoutes(bridgeConfigSchema.parse(mainnet))), connections)).toThrow(/Missing token connection/);
});

it.each(["network", "duplicate route", "conflicting metadata"])(
  "rejects ambiguous or unsupported token connections: %s",
  invalid => {
    const registry = tokenConnectionsSchema.parse(data);
    const pair = registry.mainnet.find(pair => pair.provider === "agglayer" && pair.evm.kind === "erc20")!;
    if (invalid === "network") pair.miden.network = "miden-testnet";
    if (invalid === "duplicate route") pair.routes.receive = registry.testnet[0].routes.receive;
    if (invalid === "conflicting metadata") {
      const duplicate = structuredClone(pair);
      duplicate.routes = { receive: "another-route" };
      duplicate.miden.decimals += 1;
      registry.mainnet.push(duplicate);
    }
    expect(() => tokenConnectionsSchema.parse(registry)).toThrow();
  },
);
