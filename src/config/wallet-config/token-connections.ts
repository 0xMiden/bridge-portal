import { z } from "zod";
import type { bridgeConfigSchema } from "./schema";
import type { EvmAsset, MidenAsset } from "../../bridge/core/assets";

const evmNetwork = z.enum(["sepolia", "arc-testnet", "base-sepolia", "arbitrum-sepolia", "ethereum", "arc", "base", "arbitrum", "polygon", "robinhood"]);
export const tokenLogoSchema = z.string().regex(/^\/asset-logos\/[a-z0-9-]+\.(svg|png)$/);
const metadata = { symbol: z.string().min(1).max(11), name: z.string().min(1).max(100).optional(), logo: tokenLogoSchema };
const evmMetadata = { ...metadata, network: evmNetwork, decimals: z.int().min(0).max(255) };
const connectionSchema = z.object({
  provider: z.enum(["epoch", "agglayer", "xreserve"]),
  evm: z.discriminatedUnion("kind", [
    z.object({ ...evmMetadata, kind: z.literal("native") }),
    z.object({ ...evmMetadata, kind: z.literal("erc20"), address: z.templateLiteral(["0x", z.string()]).refine(value => /^0x[\da-f]{40}$/i.test(value)) }),
  ]),
  miden: z.object({
    ...metadata, kind: z.literal("miden"), network: z.enum(["miden-testnet", "miden-mainnet"]),
    faucetId: z.string().regex(/^0x[\da-f]{30}$/i), decimals: z.int().min(0).max(18),
  }),
  routes: z.object({ receive: z.string().min(1).max(200).optional(), send: z.string().min(1).max(200).optional() }),
  disabled: z.boolean().optional(),
});
export type TokenConnection = z.infer<typeof connectionSchema>;

export const tokenConnectionsSchema = z.object({
  schemaVersion: z.literal(1), version: z.int().positive(),
  testnet: z.array(connectionSchema).min(1).max(128),
  mainnet: z.array(connectionSchema).min(1).max(128),
}).superRefine((registry, ctx) => {
  const ids = new Set<string>();
  const assets = new Map<string, string>();
  const invalid = (message: string) => ctx.addIssue({ code: "custom", message });
  for (const environment of ["testnet", "mainnet"] as const) {
    for (const { evm, miden, routes } of registry[environment]) {
      if (miden.network !== `miden-${environment}` || (environment === "testnet") !== /sepolia|testnet/.test(evm.network))
        invalid("Token connection network mismatch");
      if (!routes.receive && !routes.send) invalid("Token connection has no routes");
      for (const id of Object.values(routes)) {
        if (ids.has(id)) invalid(`Duplicate token connection route: ${id}`);
        ids.add(id);
      }
      for (const asset of [evm, miden]) {
        const identifier = asset.kind === "miden" ? asset.faucetId : asset.kind === "erc20" ? asset.address : "native";
        const key = `${asset.network}:${identifier.toLowerCase()}`;
        const value = `${asset.symbol}:${asset.decimals}`;
        if (assets.has(key) && assets.get(key) !== value) invalid(`Conflicting token metadata: ${key}`);
        assets.set(key, value);
      }
    }
  }
});

/** Validate both current routes and self-contained historical receipt snapshots. */
export function matchesMainnetEpochPair(config: z.infer<typeof bridgeConfigSchema>, evm: EvmAsset, miden: MidenAsset): boolean {
  const token = config.document.supportedEvmChains[evm.network]?.bridges.epoch?.tokens[evm.symbol];
  if (!token) return false;
  const native = token.contractAddress === "0x0000000000000000000000000000000000000000";
  if ((evm.kind === "native") !== native) return false;
  if (evm.kind === "erc20" && evm.address.toLowerCase() !== token.contractAddress.toLowerCase()) return false;
  if (native && evm.symbol !== (evm.network === "polygon" ? "POL" : "ETH")) return false;
  const output = config.document["bridge-providers"].epoch?.outputs?.[token.outputs?.[0] ?? ""];
  if (output?.faucetId !== miden.faucetId) return false;
  if (evm.symbol === "USDC") return miden.symbol === "USDCx" && miden.faucetId === config.derived.usdcxFaucetId &&
    evm.decimals === 6 && miden.decimals === 6;
  if (evm.symbol === "ETH") return miden.symbol === "ETH" && miden.faucetId === config.derived.eth.faucetId &&
    evm.decimals === 18 && miden.decimals === config.derived.eth.decimals;
  if (evm.symbol !== "POL" && evm.symbol !== "USDG") return false;
  const verified = config.derived.agglayerTokens?.find(token => token.symbol === evm.symbol);
  return Boolean(verified && miden.symbol === evm.symbol && miden.faucetId === verified.faucetId &&
    evm.decimals === verified.decimals && miden.decimals === verified.midenDecimals);
}

/** Local token pairs must agree with the pinned deployments and verified registry metadata. */
export function assertTokenConnections(config: z.infer<typeof bridgeConfigSchema>, connections: readonly TokenConnection[]) {
  const { document, derived, environment } = config;
  for (const { provider, evm, miden, disabled } of connections) {
    const key = provider === "xreserve" ? "usdcx" : provider;
    const bridge = document.supportedEvmChains[evm.network]?.bridges[key];
    if (!bridge || miden.network !== `miden-${environment}`) throw new Error(`Unconfigured token connection: ${provider}/${evm.network}`);
    if (provider === "epoch") {
      const token = bridge.tokens?.[evm.symbol];
      if (environment === "mainnet") {
        if (!matchesMainnetEpochPair(config, evm, miden)) throw new Error("Epoch token connection does not match verified configuration");
        continue;
      }
      if (token && (evm.kind !== "erc20" || token.contractAddress.toLowerCase() !== evm.address.toLowerCase()))
        throw new Error("Epoch token connection does not match wallet-config");
      const output = token?.outputs?.[0];
      if (!disabled && output && miden.symbol === evm.symbol && miden.faucetId !== document["bridge-providers"].epoch?.outputs?.[output]?.faucetId)
        throw new Error("Epoch faucet connection does not match wallet-config");
      continue;
    }
    if (provider === "xreserve") {
      if (evm.kind !== "erc20" || evm.address.toLowerCase() !== bridge.tokens?.USDC?.contractAddress.toLowerCase() ||
          miden.faucetId !== derived.usdcxFaucetId || evm.decimals !== 6 || miden.decimals !== 6)
        throw new Error("Circle token connection does not match verified configuration");
      continue;
    }
    if (evm.kind === "native") {
      if (evm.decimals !== 18 || miden.faucetId !== derived.eth.faucetId || miden.decimals !== derived.eth.decimals)
        throw new Error("ETH token connection does not match verified configuration");
      continue;
    }
    // Local additions are verified on-chain without upgrading other providers' configuration.
    const verified = derived.agglayerTokens?.find(token => token.address.toLowerCase() === evm.address.toLowerCase());
    if (!verified || verified.faucetId !== miden.faucetId || verified.decimals !== evm.decimals || verified.midenDecimals !== miden.decimals)
      throw new Error(`Agglayer token connection does not match verified configuration: ${evm.symbol}`);
  }
  // Mainnet's configured ERC-20 list must not be silently narrowed by a second allowlist.
  if (environment === "mainnet") {
    for (const [network, chain] of Object.entries(document.supportedEvmChains)) {
      for (const token of Object.values(chain.bridges.agglayer?.tokens ?? {})) {
        if (!connections.some(pair => pair.provider === "agglayer" && pair.evm.network === network && pair.evm.kind === "erc20" &&
            pair.evm.address.toLowerCase() === token.contractAddress.toLowerCase()))
          throw new Error(`Missing token connection for configured Agglayer token: ${token.contractAddress}`);
      }
    }
  }
}
