import data from "./v1.json";
import { nearConfigSchema } from "../wallet-config/schema";

/** Release-owned pins. Never discover routes from the live 1Click catalog. */
export const nearConfig = nearConfigSchema.parse(data);
/** Build-time visibility gate; the server independently gates new executable quotes. */
export const nearRoutesEnabled = process.env.NEXT_PUBLIC_NEAR_ENABLED === "true";
