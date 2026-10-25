// SDK-backed validation for execution paths. Import dynamically from modules
// used during rendering so the eager browser SDK stays out of server rendering.
import { AccountId } from "@miden-sdk/miden-sdk";

/** The caller owns the returned SDK account ID. */
export function parseMidenAccountId(value: string): AccountId {
  const raw = value.trim();
  return /^(?:0x)?[0-9a-f]+$/i.test(raw)
    ? AccountId.fromHex(`0x${raw.replace(/^0x/i, "")}`)
    : AccountId.fromBech32(raw);
}

export function normalizeMidenIdToHex(value: string): string {
  const id = parseMidenAccountId(value);
  try {
    return id.toString();
  } finally {
    // The browser uses WASM wrappers; the SDK's native Node objects need no free.
    id.free?.();
  }
}
