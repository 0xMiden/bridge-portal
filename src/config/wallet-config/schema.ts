import { z } from "zod";

const environmentSchema = z.enum(["testnet", "mainnet"]);
const networkSchema = z.enum(["sepolia", "arc-testnet", "base-sepolia", "arbitrum-sepolia", "ethereum", "arc", "base", "arbitrum"]);
const address = z.templateLiteral(["0x", z.string()]).refine(value => /^0x[\da-f]{40}$/i.test(value));
const account = z.string().regex(/^0x[\da-f]{30}$/i);
const decimals = z.int().min(0).max(18);
// Requests may contain old recovery data. Only these exact service roots are
// allowed, even if a caller supplies a structurally valid config. Redirects
// from these services are rejected by server transports.
const services = {
  testnet: {
    agglayer: "https://bridge.miden-testnet.gateway.fm/api",
    attestation: "https://xreserve-api-testnet.circle.com",
    iris: "https://iris-api-sandbox.circle.com",
    epoch: "https://testnet-dev.epochprotocol.xyz",
  },
  mainnet: {
    agglayer: "https://bridge-cedar-miden.eu-north-3.gateway.fm/api",
    attestation: "https://xreserve-api.circle.com",
    iris: "https://iris-api.circle.com",
    epoch: undefined,
  },
} as const;
const token = z.object({ contractAddress: address, outputs: z.array(z.string().max(80)).max(32).optional() });
const bridge = z.object({
  depositEnabled: z.boolean(), withdrawalEnabled: z.boolean(),
  contractAddress: address.optional(), midenBridgeId: account.optional(),
  domain: z.int().nonnegative().max(0xffffffff).optional(),
  tokens: z.record(z.string().regex(/^[A-Z0-9]{1,11}$/), token).optional(),
  deposit: z.discriminatedUnion("route", [
    z.object({ route: z.literal("xreserve"), xReserve: address }),
    z.object({ route: z.literal("executor"), executorChain: networkSchema, tokenMessenger: address, tokenMessengerWithFees: address }),
  ]).optional(),
  executor: z.object({ address, handler: address }).optional(),
});
const ids = { sepolia: 11155111, "arc-testnet": 5042002, "base-sepolia": 84532, "arbitrum-sepolia": 421614,
  ethereum: 1, arc: 5042, base: 8453, arbitrum: 42161 };
const domains = { sepolia: 0, ethereum: 0, "base-sepolia": 6, base: 6, "arbitrum-sepolia": 3, arbitrum: 3, "arc-testnet": 26, arc: 26 };
export const walletDocumentSchema = z.object({
  network: environmentSchema,
  version: z.int().positive(),
  features: z.object({ fastBridge: z.boolean().optional(), bridgeIn: z.boolean().optional(), bridgeOut: z.boolean().optional() }),
  "bridge-providers": z.object({
    agglayer: z.object({ indexerUrl: z.string().max(256) }),
    usdcx: z.object({ midenDomain: z.int().nonnegative().max(0xffffffff), attestationUrl: z.string().max(256), irisUrl: z.string().max(256) }),
    epoch: z.object({ allocatorUrl: z.string().max(256), outputs: z.record(z.string().max(80), z.object({ faucetId: account })).optional() }).optional(),
  }),
  supportedEvmChains: z.partialRecord(networkSchema, z.object({ chainId: z.int().positive(), bridges: z.object({ agglayer: bridge.optional(), usdcx: bridge.optional(), epoch: bridge.optional() }) })),
}).superRefine((doc, ctx) => {
  const invalid = (message: string) => ctx.addIssue({ code: "custom", message });
  const allowed = services[doc.network];
  const p = doc["bridge-providers"];
  if (p.agglayer.indexerUrl !== allowed.agglayer || p.usdcx.attestationUrl !== allowed.attestation || p.usdcx.irisUrl !== allowed.iris ||
      (p.epoch && p.epoch.allocatorUrl !== allowed.epoch)) invalid("Unapproved service URL");
  const arc = doc.network === "mainnet" ? "arc" : "arc-testnet";
  for (const [slug, chain] of Object.entries(doc.supportedEvmChains)) {
    const network = slug as keyof typeof ids;
    if (ids[network] !== chain.chainId || (doc.network === "testnet") !== /sepolia|testnet/.test(network)) invalid("Network mismatch");
    const { agglayer, usdcx, epoch } = chain.bridges;
    if (agglayer && (!agglayer.contractAddress || !agglayer.midenBridgeId || network !== (doc.network === "mainnet" ? "ethereum" : "sepolia"))) invalid("Unsupported Agglayer deployment");
    if (epoch && (!p.epoch || !epoch.tokens?.USDC || doc.network !== "testnet")) invalid("Unsupported Epoch deployment");
    if (epoch && (epoch.depositEnabled || epoch.withdrawalEnabled)) {
      const output = epoch.tokens?.USDC?.outputs?.[0];
      if (!output || !p.epoch?.outputs?.[output]) invalid("Unresolved Epoch output");
    }
    if (usdcx && (usdcx.domain !== domains[network] || !usdcx.tokens?.USDC ||
      (network === arc ? usdcx.deposit?.route !== "xreserve" || !usdcx.executor : usdcx.deposit?.route !== "executor" || usdcx.deposit.executorChain !== arc))) invalid("Unsupported Circle deployment");
    if (usdcx?.deposit?.route === "executor" && !doc.supportedEvmChains[arc]?.bridges.usdcx)
      invalid("Unresolved Circle executor chain");
  }
});

export const bridgeConfigSchema = z.object({
  schemaVersion: z.literal(1), id: z.string().max(80), environment: environmentSchema,
  document: walletDocumentSchema,
  derived: z.object({
    rollupId: z.int().positive().max(0xffffffff), eth: z.object({ faucetId: account, decimals }),
    usdcxFaucetId: account,
    agglayerTokens: z.array(z.object({ symbol: z.string().max(11), name: z.string().max(100), address, decimals: z.int().min(0).max(255), faucetId: account, midenDecimals: decimals })).max(32).optional(),
  }),
}).superRefine((config, ctx) => {
  if (config.environment !== config.document.network || config.id !== `${config.environment}:${config.document.version}`)
    ctx.addIssue({ code: "custom", message: "Configuration identity mismatch" });
});
