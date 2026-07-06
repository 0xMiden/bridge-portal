import { formatUnits } from "viem";
import type { MidenFiWalletContextState } from "@miden-sdk/miden-wallet-adapter-react";
import type { Activity } from "../bridge-state";

// Miden is a privacy chain — there's no public API for an account's activity.
// The connected MidenFi wallet holds the account's (chain-synced) private state,
// so we read its notes with the user's approval and build the Miden-side history
// from them. Device-independent: any device with the same seed re-syncs the
// same notes.
//
// requestConsumableNotes() returns the account's input notes (received /
// mint-delivered — e.g. bridged funds arriving on Miden). Amounts + faucet come
// from each note's assets. Best-effort: known faucets map to a token; the note
// carries no timestamp so ordering within this source is by wallet order.

const KNOWN_FAUCETS: Record<
  string,
  { symbol: string; decimals: number; provider: "epoch" | "agglayer" }
> = {
  // Epoch Miden USDC / AggLayer Miden ETH (post rollup-78 relaunch).
  "0xfc90f0f4da30e51168453b60eafed7": {
    symbol: "USDC",
    decimals: 6,
    provider: "epoch",
  },
  "0x387149ae66116cf114eebd60bb7381": {
    symbol: "ETH",
    decimals: 8,
    provider: "agglayer",
  },
};

const norm = (id: string) => id.trim().toLowerCase();

export async function fetchMidenHistory({
  requestConsumableNotes,
  midenAccount,
}: {
  requestConsumableNotes: NonNullable<
    MidenFiWalletContextState["requestConsumableNotes"]
  >;
  midenAccount?: string;
}): Promise<Activity[]> {
  const notes = await requestConsumableNotes().catch(() => []);
  const out: Activity[] = [];

  notes.forEach((note, index) => {
    for (const asset of note.assets ?? []) {
      const faucet = KNOWN_FAUCETS[norm(asset.faucetId)];
      const symbol = faucet?.symbol ?? "token";
      const amount = (() => {
        try {
          return faucet
            ? formatUnits(BigInt(asset.amount), faucet.decimals)
            : asset.amount;
        } catch {
          return asset.amount;
        }
      })();
      out.push({
        id: `miden-${note.noteId}`,
        mode: "receive",
        provider: faucet?.provider ?? "agglayer",
        summary: `Receive ${amount} ${symbol} on Miden`,
        // A consumable note has arrived and is ready to consume on Miden.
        status: "claim_available",
        eta: "",
        amount,
        asset: symbol,
        txHash: note.noteId,
        midenTxId: note.noteId,
        updatedAt: "",
        sortKey: index,
        midenAccount,
      });
    }
  });

  return out;
}
