import v1 from "./v1.json";
import v2 from "./v2";
import { nearConfigSchema } from "../wallet-config/schema";

/** Release-owned pins. Never discover routes from the live 1Click catalog. */
export const nearConfig = nearConfigSchema.parse(v2);

// Retain released bindings even after a pair is retired from the active catalog.
const firstRelease = nearConfigSchema.parse(v1);
const legacyBitcoin = firstRelease.routes.filter(pair => pair.destination.network === "bitcoin").map(pair => ({
  ...pair, source: { ...pair.source, assetId: `nep141:miden-${pair.source.faucetId}.omft.near` },
}));
export const nearReceiptPairs = [...nearConfig.routes, ...firstRelease.routes, ...legacyBitcoin];
