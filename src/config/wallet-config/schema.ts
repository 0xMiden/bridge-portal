import { z } from "zod";

const environmentSchema = z.enum(["testnet", "mainnet"]);
const networks = {
  sepolia: { environment: "testnet", chainId: 11155111, circleDomain: 0, agglayer: true, epoch: true },
  "arc-testnet": { environment: "testnet", chainId: 5042002, circleDomain: 26, agglayer: false, epoch: false },
  "base-sepolia": { environment: "testnet", chainId: 84532, circleDomain: 6, agglayer: false, epoch: false },
  "arbitrum-sepolia": { environment: "testnet", chainId: 421614, circleDomain: 3, agglayer: false, epoch: false },
  ethereum: { environment: "mainnet", chainId: 1, circleDomain: 0, agglayer: true, epoch: true },
  arc: { environment: "mainnet", chainId: 5042, circleDomain: 26, agglayer: false, epoch: false },
  base: { environment: "mainnet", chainId: 8453, circleDomain: 6, agglayer: false, epoch: true },
  arbitrum: { environment: "mainnet", chainId: 42161, circleDomain: 3, agglayer: false, epoch: true },
  polygon: { environment: "mainnet", chainId: 137, circleDomain: 7, agglayer: false, epoch: true },
  robinhood: { environment: "mainnet", chainId: 4663, circleDomain: null, agglayer: false, epoch: true },
} as const satisfies Record<string, {
  environment: z.infer<typeof environmentSchema>;
  chainId: number;
  circleDomain: number | null;
  agglayer: boolean;
  epoch: boolean;
}>;
type Network = keyof typeof networks;
const networkSchema = z.enum(Object.keys(networks) as Network[]);
const circleExecutorChains = { testnet: "arc-testnet", mainnet: "arc" } as const satisfies Record<
  z.infer<typeof environmentSchema>, Network
>;
const address = z.templateLiteral(["0x", z.string()]).refine(value => /^0x[\da-f]{40}$/i.test(value));
const account = z.string().regex(/^0x[\da-f]{30}$/i);
const decimals = z.int().min(0).max(18);
const uint32 = z.int().nonnegative().max(0xffffffff);
const epochMainnetAllocatorUrl = "https://mainnet-api.epochprotocol.xyz";

// Requests may contain old recovery data. Only these exact service roots are
// allowed, even if a caller supplies a structurally valid config. Redirects
// from these services are rejected by server transports.
const services = {
  testnet: {
    agglayer: "https://bridge.miden-testnet.gateway.fm/api",
    attestation: "https://xreserve-api-testnet.circle.com",
    iris: "https://iris-api-sandbox.circle.com",
    epoch: ["https://testnet-dev.epochprotocol.xyz"],
  },
  mainnet: {
    agglayer: "https://bridge-cedar-miden.eu-north-3.gateway.fm/api",
    attestation: "https://xreserve-api.circle.com",
    iris: "https://iris-api.circle.com",
    epoch: [
      epochMainnetAllocatorUrl,
      // Historical receipts retain the service root used for their transfer.
      "https://miden-smallocator.epochprotocol.xyz",
    ],
  },
} as const;
const token = z.object({
  contractAddress: address,
  outputs: z.array(z.string().max(80)).max(32).optional(),
});
const tokens = z.record(z.string().regex(/^[A-Z0-9]{1,11}$/), token);
const usdcTokens = tokens.and(z.object({ USDC: token }));
const deposit = z.discriminatedUnion("route", [
  z.object({ route: z.literal("xreserve"), xReserve: address }),
  z.object({
    route: z.literal("executor"),
    executorChain: networkSchema,
    tokenMessenger: address,
    tokenMessengerWithFees: address,
  }),
]);

// Retain shared fields when specializing providers so parsing preserves
// historical recovery snapshots, including fields unused by that provider.
const bridge = z.object({
  depositEnabled: z.boolean(),
  withdrawalEnabled: z.boolean(),
  contractAddress: address.optional(),
  midenBridgeId: account.optional(),
  domain: uint32.optional(),
  tokens: tokens.optional(),
  deposit: deposit.optional(),
  executor: z.object({ address, handler: address }).optional(),
});
const agglayerBridge = bridge.extend({ contractAddress: address, midenBridgeId: account });
const circleBridge = bridge.extend({ domain: uint32, tokens: usdcTokens, deposit });
const epochBridge = bridge.extend({ tokens: tokens.refine(value => Object.keys(value).length > 0) });

const walletDocument = z.object({
  network: environmentSchema,
  version: z.int().positive(),
  features: z.object({
    fastBridge: z.boolean().optional(),
    bridgeIn: z.boolean().optional(),
    bridgeOut: z.boolean().optional(),
  }),
  "bridge-providers": z.object({
    agglayer: z.object({ indexerUrl: z.string().max(256) }),
    usdcx: z.object({
      midenDomain: uint32,
      attestationUrl: z.string().max(256),
      irisUrl: z.string().max(256),
    }),
    epoch: z.object({
      allocatorUrl: z.string().max(256),
      outputs: z.record(z.string().max(80), z.object({ faucetId: account })).optional(),
    }).optional(),
  }),
  supportedEvmChains: z.partialRecord(networkSchema, z.object({
    chainId: z.int().positive(),
    bridges: z.object({
      agglayer: agglayerBridge.optional(),
      usdcx: circleBridge.optional(),
      epoch: epochBridge.optional(),
    }),
  })),
});
type WalletDocument = z.infer<typeof walletDocument>;
type Chain = NonNullable<WalletDocument["supportedEvmChains"][Network]>;

function invalid(ctx: z.RefinementCtx, path: string[], message: string) {
  ctx.addIssue({ code: "custom", path, message });
}

function validateServiceUrls(doc: WalletDocument, ctx: z.RefinementCtx) {
  const allowed = services[doc.network];
  const providers = doc["bridge-providers"];
  if (providers.agglayer.indexerUrl !== allowed.agglayer) {
    invalid(ctx, ["bridge-providers", "agglayer", "indexerUrl"], "Unapproved service URL");
  }
  if (providers.usdcx.attestationUrl !== allowed.attestation) {
    invalid(ctx, ["bridge-providers", "usdcx", "attestationUrl"], "Unapproved service URL");
  }
  if (providers.usdcx.irisUrl !== allowed.iris) {
    invalid(ctx, ["bridge-providers", "usdcx", "irisUrl"], "Unapproved service URL");
  }
  const epochUrl = providers.epoch?.allocatorUrl;
  if (epochUrl !== undefined && !allowed.epoch.some(url => url === epochUrl)) {
    invalid(ctx, ["bridge-providers", "epoch", "allocatorUrl"], "Unapproved service URL");
  }
}

function validateNetwork(doc: WalletDocument, network: Network, chain: Chain, ctx: z.RefinementCtx) {
  const deployment = networks[network];
  if (chain.chainId !== deployment.chainId) {
    invalid(ctx, ["supportedEvmChains", network, "chainId"], "Network mismatch");
  }
  if (doc.network !== deployment.environment) {
    invalid(ctx, ["supportedEvmChains", network], "Network mismatch");
  }
}

function validateAgglayerDeployment(network: Network, chain: Chain, ctx: z.RefinementCtx) {
  if (!chain.bridges.agglayer) return;
  if (!networks[network].agglayer) {
    invalid(ctx, ["supportedEvmChains", network, "bridges", "agglayer"], "Unsupported Agglayer deployment");
  }
}

function allowsImplicitEpochOutput(doc: WalletDocument, symbol: string, entry: z.infer<typeof token>) {
  // Historical snapshots can carry unused tokens from shared provider fields.
  // Active portal pairs separately require a resolved output in assertTokenConnections.
  if (symbol !== "USDC" && entry.outputs === undefined) return true;
  const provider = doc["bridge-providers"].epoch;
  if (doc.network !== "mainnet" || provider?.allocatorUrl !== epochMainnetAllocatorUrl) return false;
  // Current mainnet documents omit USDCx references; withPortalEpochRoutes
  // resolves them from the verified Circle faucet before routes are used.
  return symbol === "USDC" && entry.outputs === undefined && provider.outputs === undefined;
}

function validateEpochDeployment(doc: WalletDocument, network: Network, chain: Chain, ctx: z.RefinementCtx) {
  const epoch = chain.bridges.epoch;
  if (!epoch) return;
  const provider = doc["bridge-providers"].epoch;
  const path = ["supportedEvmChains", network, "bridges", "epoch"];
  if (!provider || !networks[network].epoch) {
    invalid(ctx, path, "Unsupported Epoch deployment");
  }
  if (!epoch.depositEnabled && !epoch.withdrawalEnabled) return;
  for (const [symbol, entry] of Object.entries(epoch.tokens)) {
    if (allowsImplicitEpochOutput(doc, symbol, entry)) continue;
    const output = entry.outputs?.[0];
    if (!output || !provider?.outputs?.[output]) invalid(ctx, [...path, "tokens", symbol, "outputs"], "Unresolved Epoch output");
  }
}

function supportsCircleRoute(circle: z.infer<typeof circleBridge>, network: Network, executorChain: Network) {
  if (network === executorChain) return circle.deposit.route === "xreserve" && Boolean(circle.executor);
  return circle.deposit.route === "executor" && circle.deposit.executorChain === executorChain;
}

function validateCircleDeployment(doc: WalletDocument, network: Network, chain: Chain, ctx: z.RefinementCtx) {
  const circle = chain.bridges.usdcx;
  if (!circle) return;
  const executorChain = circleExecutorChains[doc.network];
  const path = ["supportedEvmChains", network, "bridges", "usdcx"];
  if (circle.domain !== networks[network].circleDomain) {
    invalid(ctx, [...path, "domain"], "Unsupported Circle deployment");
  }
  if (!supportsCircleRoute(circle, network, executorChain)) {
    invalid(ctx, path, "Unsupported Circle deployment");
  }
  if (circle.deposit.route === "executor" && !doc.supportedEvmChains[executorChain]?.bridges.usdcx) {
    invalid(ctx, [...path, "deposit", "executorChain"], "Unresolved Circle executor chain");
  }
}

export const walletDocumentSchema = walletDocument.superRefine((doc, ctx) => {
  validateServiceUrls(doc, ctx);
  for (const network of networkSchema.options) {
    const chain = doc.supportedEvmChains[network];
    if (!chain) continue;
    validateNetwork(doc, network, chain, ctx);
    validateAgglayerDeployment(network, chain, ctx);
    validateEpochDeployment(doc, network, chain, ctx);
    validateCircleDeployment(doc, network, chain, ctx);
  }
});

export const bridgeConfigSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().max(80),
  environment: environmentSchema,
  document: walletDocumentSchema,
  derived: z.object({
    rollupId: z.int().positive().max(0xffffffff),
    eth: z.object({ faucetId: account, decimals }),
    usdcxFaucetId: account,
    agglayerTokens: z.array(z.object({
      symbol: z.string().max(11),
      name: z.string().max(100),
      address,
      decimals: z.int().min(0).max(255),
      faucetId: account,
      midenDecimals: decimals,
    })).max(32).optional(),
  }),
}).superRefine((config, ctx) => {
  if (config.environment !== config.document.network) {
    invalid(ctx, ["environment"], "Configuration identity mismatch");
  }
  if (config.id !== `${config.environment}:${config.document.version}`) {
    invalid(ctx, ["id"], "Configuration identity mismatch");
  }
});
