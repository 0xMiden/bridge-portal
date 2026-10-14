import { normalizeMidenAccountHex } from "./providers/agglayer/agglayer";

export function midenAccountLink(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return `0x${normalizeMidenAccountHex(value)}`;
  } catch {
    return undefined;
  }
}
