import data from "./v1.json";
import { nearConfigSchema } from "../wallet-config/schema";

/** Release-owned pins. Never discover routes from the live 1Click catalog. */
export const nearConfig = nearConfigSchema.parse(data);
