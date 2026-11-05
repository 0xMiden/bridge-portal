import { expect, it } from "vitest";
import { bridgeConfigSchema } from "./schema";
import mainnet from "./mainnet.json";
import { currentBridgeConfig } from "../bridge-config";
import { withPortalEpochRoutes } from "./epoch-mainnet";

it.each([
  ["https://mainnet-api.epochprotocol.xyz", true],
  ["https://miden-smallocator.epochprotocol.xyz", true],
  ["https://testnet-dev.epochprotocol.xyz", false],
  ["https://mainnet-api.epochprotocol.xyz.evil.example", false],
])("validates the Epoch service root in saved mainnet recovery data: %s", (allocatorUrl, approved) => {
  const recovery = structuredClone(currentBridgeConfig("mainnet"));
  recovery.document["bridge-providers"].epoch!.allocatorUrl = allocatorUrl;
  expect(bridgeConfigSchema.safeParse(JSON.parse(JSON.stringify(recovery))).success).toBe(approved);
});

it("imports mainnet Epoch's implicit USDCx output and resolves its verified faucet", () => {
  const source = bridgeConfigSchema.parse(mainnet);
  source.id = "mainnet:16";
  source.document.version = 16;
  source.document["bridge-providers"].epoch = { allocatorUrl: "https://mainnet-api.epochprotocol.xyz" };
  source.document.supportedEvmChains.ethereum!.bridges.epoch = {
    depositEnabled: true, withdrawalEnabled: true,
    tokens: { USDC: { contractAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" } },
  };

  const imported = bridgeConfigSchema.parse(source);
  const effective = bridgeConfigSchema.parse(withPortalEpochRoutes(imported));
  expect(effective.document["bridge-providers"].epoch?.outputs).toMatchObject({
    USDCx: { faucetId: "0xe69e6ca6e39df1b10c1e5399399feb" },
  });
  expect(effective.document.supportedEvmChains.ethereum?.bridges.epoch?.tokens?.USDC.outputs).toEqual(["USDCx"]);
  expect(imported.document["bridge-providers"].epoch?.outputs).toBeUndefined();
});

it.each([
  ["testnet", "Circle executor chain"],
  ["testnet", "Epoch output reference"],
  ["testnet", "Epoch output faucet"],
  ["mainnet", "Epoch output reference"],
  ["mainnet", "Epoch output faucet"],
] as const)(
  "rejects an unresolved %s %s before configuration can be used",
  (environment, missing) => {
    const config = structuredClone(currentBridgeConfig(environment));
    const epoch = config.document.supportedEvmChains[environment === "mainnet" ? "ethereum" : "sepolia"]!.bridges.epoch!;
    if (missing === "Circle executor chain") delete config.document.supportedEvmChains["arc-testnet"];
    if (missing === "Epoch output reference") epoch.tokens!.USDC.outputs = [];
    if (missing === "Epoch output faucet") config.document["bridge-providers"].epoch!.outputs = {};
    expect(() => bridgeConfigSchema.parse(config)).toThrow(/Unresolved (Circle executor|Epoch output)/);
  },
);

it.each([
  ["agglayer", "contractAddress"],
  ["agglayer", "midenBridgeId"],
  ["usdcx", "domain"],
  ["usdcx", "deposit"],
  ["usdcx", "tokens"],
  ["epoch", "tokens"],
] as const)("requires %s.%s even when the deployment is disabled", (provider, field) => {
  const config = structuredClone(currentBridgeConfig("testnet"));
  const bridge = config.document.supportedEvmChains.sepolia!.bridges[provider]!;
  bridge.depositEnabled = false;
  bridge.withdrawalEnabled = false;
  Reflect.deleteProperty(bridge, field);

  const result = bridgeConfigSchema.safeParse(config);
  expect(result.success).toBe(false);
  expect(result.error?.issues).toContainEqual(expect.objectContaining({
    path: ["document", "supportedEvmChains", "sepolia", "bridges", provider, field],
  }));
});

it.each(["usdcx", "epoch"] as const)("requires USDC among %s's configured tokens", provider => {
  const config = structuredClone(currentBridgeConfig("testnet"));
  const bridge = config.document.supportedEvmChains.sepolia!.bridges[provider]!;
  Reflect.deleteProperty(bridge.tokens, "USDC");
  expect(bridgeConfigSchema.safeParse(config).success).toBe(false);
});

it.each([
  { path: ["document", "bridge-providers", "agglayer", "indexerUrl"], value: "https://evil.example", message: "Unapproved service URL" },
  { path: ["document", "bridge-providers", "usdcx", "attestationUrl"], value: "https://evil.example", message: "Unapproved service URL" },
  { path: ["document", "bridge-providers", "usdcx", "irisUrl"], value: "https://evil.example", message: "Unapproved service URL" },
  { path: ["document", "supportedEvmChains", "ethereum", "chainId"], value: 137, message: "Network mismatch" },
  { path: ["document", "supportedEvmChains", "sepolia"], value: { chainId: 11155111, bridges: {} }, message: "Network mismatch" },
  { path: ["document", "supportedEvmChains", "ethereum", "bridges", "usdcx", "domain"], value: 7, message: "Unsupported Circle deployment" },
  { path: ["id"], value: "mainnet:999", message: "Configuration identity mismatch" },
  { path: ["environment"], value: "testnet", message: "Configuration identity mismatch" },
])("identifies the invalid configuration field: $path", ({ path, value, message }) => {
  const config = structuredClone(currentBridgeConfig("mainnet"));
  let parent = config as unknown as Record<string, unknown>;
  for (const key of path.slice(0, -1)) parent = parent[key] as Record<string, unknown>;
  parent[path.at(-1)!] = value;

  const result = bridgeConfigSchema.safeParse(config);
  expect(result.success).toBe(false);
  expect(result.error?.issues).toContainEqual(expect.objectContaining({ path, message }));
});

it.each([
  ["testnet", "base-sepolia", "agglayer"],
  ["testnet", "base-sepolia", "epoch"],
  ["mainnet", "base", "agglayer"],
  ["mainnet", "arc", "epoch"],
] as const)("rejects an unsupported %s %s deployment for %s", (environment, network, provider) => {
  const config = structuredClone(currentBridgeConfig(environment));
  const source = config.document.supportedEvmChains[environment === "mainnet" ? "ethereum" : "sepolia"]!;
  Object.assign(config.document.supportedEvmChains[network]!.bridges, { [provider]: source.bridges[provider] });

  const result = bridgeConfigSchema.safeParse(config);
  expect(result.success).toBe(false);
  expect(result.error?.issues).toContainEqual(expect.objectContaining({
    path: ["document", "supportedEvmChains", network, "bridges", provider],
    message: `Unsupported ${provider === "agglayer" ? "Agglayer" : "Epoch"} deployment`,
  }));
});

it("preserves shared provider fields and additional tokens in recovery snapshots", () => {
  const config = structuredClone(currentBridgeConfig("testnet"));
  const chain = config.document.supportedEvmChains.sepolia!;
  const shared = {
    ...chain.bridges.agglayer!,
    ...chain.bridges.usdcx!,
    ...chain.bridges.epoch!,
    tokens: { ...chain.bridges.epoch!.tokens, USDC: chain.bridges.epoch!.tokens.USDC,
      EXTRA: { contractAddress: "0x1111111111111111111111111111111111111111" as const } },
    executor: config.document.supportedEvmChains["arc-testnet"]!.bridges.usdcx!.executor,
  };
  chain.bridges = { agglayer: shared, usdcx: shared, epoch: shared };

  const parsed = bridgeConfigSchema.parse(config);
  expect(parsed.document.supportedEvmChains.sepolia!.bridges).toEqual(chain.bridges);
});
