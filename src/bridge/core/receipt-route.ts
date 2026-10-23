import { z } from "zod";
import { bridgeConfigSchema } from "../../config/wallet-config/schema";
import { evmAddressSchema } from "../evm/evm-schema";

const network = z.enum(["sepolia", "arc-testnet", "base-sepolia", "arbitrum-sepolia", "ethereum", "arc", "base", "arbitrum"]);
const metadata = { symbol: z.string().min(1).max(11), name: z.string().max(100).optional(), decimals: z.int().min(0).max(18) };
const asset = z.discriminatedUnion("kind", [
  z.object({ ...metadata, kind: z.literal("native"), network }),
  z.object({ ...metadata, kind: z.literal("erc20"), network, address: evmAddressSchema }),
  z.object({ ...metadata, kind: z.literal("miden"), network: z.enum(["miden-testnet", "miden-mainnet"]), faucetId: z.string().regex(/^0x[\da-f]{30}$/i) }),
]);
/** Receipts are self-contained. Route names and current token lists may change. */
export const receiptRouteSchema = z.object({
  id: z.string().min(1).max(200), provider: z.enum(["epoch", "agglayer", "xreserve"]), mode: z.enum(["send", "receive"]),
  source: asset, destination: asset, recovery: bridgeConfigSchema, disabled: z.boolean().optional(),
}).refine(route => {
  const miden = route.mode === "receive" ? route.destination : route.source;
  const evm = route.mode === "receive" ? route.source : route.destination;
  if (miden.kind !== "miden" || evm.kind === "miden" || miden.network !== `miden-${route.recovery.environment}`) return false;
  const bridge = route.recovery.document.supportedEvmChains[evm.network]?.bridges;
  const derived = route.recovery.derived;
  if (route.provider === "epoch") return route.recovery.environment === "testnet" && !!bridge?.epoch;
  if (route.provider === "xreserve") return evm.kind === "erc20" &&
    evm.address.toLowerCase() === bridge?.usdcx?.tokens?.USDC?.contractAddress.toLowerCase() &&
    miden.faucetId === derived.usdcxFaucetId && miden.decimals === 6 && evm.decimals === 6;
  if (!bridge?.agglayer) return false;
  if (evm.kind === "native") return miden.faucetId === derived.eth.faucetId && miden.decimals === derived.eth.decimals && evm.decimals === 18;
  return derived.agglayerTokens?.some(token => token.address.toLowerCase() === evm.address.toLowerCase() &&
    token.faucetId === miden.faucetId && token.decimals === evm.decimals && token.midenDecimals === miden.decimals) ?? false;
});
