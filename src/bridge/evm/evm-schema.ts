import { z } from "zod";

const hexPrefix = z.templateLiteral(["0x", z.string()]);

export const evmAddressSchema = z.string().regex(/^0x[\da-fA-F]{40}$/).pipe(hexPrefix);
export const transactionHashSchema = z.string().regex(/^0x[\da-fA-F]{64}$/).pipe(hexPrefix);
export const hexDataSchema = z.string().regex(/^0x(?:[\da-fA-F]{2})*$/).pipe(hexPrefix);
export const rpcQuantitySchema = z.string().regex(/^0x(?:0|[1-9a-fA-F][\da-fA-F]*)$/);
