"use client";

import { useMemo } from "react";

import type { SolveIntentParams } from "@epoch-protocol/epoch-intents-sdk";
import { AccountId, AccountInterface, NetworkId } from "@miden-sdk/miden-sdk";
import type { MidenSendTransaction } from "@miden-sdk/miden-wallet-adapter-base";
import {
  type MidenFiWalletContextState,
  useMidenFiWallet,
} from "@miden-sdk/miden-wallet-adapter-react";

import { MIDEN_MIN_RECLAIM_BLOCKS } from "./config";

/**
 * bridge-portal's implementation of Epoch's Miden→EVM `createMidenP2IDNote`
 * callback — the piece the wallet did through its internal tx pipeline. Here we
 * mint the recallable P2IDE collateral note through the connected MidenFi wallet
 * adapter's `requestSend`, which is all this app has (and all it needs).
 *
 * The SDK invokes this callback during `solveIntent` (only once the allocator
 * confirms a resource lock is required). It hands us the faucet, base-unit
 * amount, and the allocator's Miden account; we must create the note and return
 * its committed note id so the allocator can pick it up.
 */

/** The Epoch SDK's createMidenP2IDNote callback shape, made non-optional. */
export type CreateMidenP2IDNote = NonNullable<SolveIntentParams["createMidenP2IDNote"]>;

/**
 * Wallet methods the note creator needs, injected rather than hook-bound so the
 * factory stays unit-testable. `useCreateBridgeP2IDNote` wires these from
 * `useMidenFiWallet()`.
 */
export interface MidenNoteDeps {
  requestSend: NonNullable<MidenFiWalletContextState["requestSend"]>;
  waitForTransaction: NonNullable<MidenFiWalletContextState["waitForTransaction"]>;
  /** Connected sender's Miden account — bech32 (`mtst1…`) or 0x hex. */
  senderAddress: string;
  /**
   * Optional sink for the committed note details. The note is minted *inside*
   * the SDK's `solveIntent`, so the surrounding flow can't otherwise see the
   * Miden tx hash / note id — this surfaces them for activity tracking.
   */
  onNoteCreated?: (info: { noteId: string; txHash: string }) => void;
}

/**
 * Normalize a Miden account id to the bech32 form the adapter expects. The SDK
 * passes faucet / allocator ids as 0x hex; the connected wallet address is
 * already bech32. Mirrors the wallet's `ifHextoBech32`.
 */
function toBech32Account(value: string): string {
  const raw = (value ?? "").trim();
  if (raw.startsWith("0x") || raw.startsWith("0X")) {
    return AccountId.fromHex(raw).toBech32(NetworkId.testnet(), AccountInterface.BasicWallet);
  }
  return raw;
}

/**
 * Build the `createMidenP2IDNote` callback bound to a connected MidenFi wallet.
 *
 * One on-chain action: a public, recallable P2IDE note to the allocator. The
 * presence of `recallBlocks` is what makes the adapter mint a P2IDE (recallable)
 * note instead of a plain P2ID — so the user can reclaim the funds if the intent
 * never fills. `recallBlocks` is a RELATIVE delta; the adapter resolves it to
 * `currentBlock + delta`, which must line up with the ABSOLUTE
 * `midenReclaimHeight` the intent declared (both derived from
 * `MIDEN_MIN_RECLAIM_BLOCKS`).
 */
export function createBridgeP2IDNoteCallback(deps: MidenNoteDeps): CreateMidenP2IDNote {
  return async (faucetId, amount, allocatorId) => {
    try {
      // `amount` is base units (matches the bigint the intent params carried).
      // The adapter's send API is number-typed, so we widen here; testnet
      // amounts stay well inside Number.MAX_SAFE_INTEGER.
      const amountUnits = Number(amount);
      if (!Number.isFinite(amountUnits) || amountUnits <= 0) {
        throw new Error(`Invalid Miden bridge amount: "${amount}".`);
      }

      const transaction: MidenSendTransaction = {
        senderAddress: toBech32Account(deps.senderAddress),
        recipientAddress: toBech32Account(allocatorId),
        faucetId: toBech32Account(faucetId),
        noteType: "public",
        amount: amountUnits,
        recallBlocks: MIDEN_MIN_RECLAIM_BLOCKS,
      };

      // requestSend resolves to the tx id once the wallet proves + submits;
      // waitForTransaction blocks until it commits and surfaces the output notes.
      const txId = await deps.requestSend(transaction);
      const output = await deps.waitForTransaction(txId);
      const noteId = output.outputNotes?.[0]?.id().toString();
      if (!noteId) {
        console.error("[epoch] bridge note committed but no output note id", { txId });
        return { success: false };
      }

      console.log("[epoch] bridge P2IDE note created", { noteId, txHash: output.txHash });
      deps.onNoteCreated?.({ noteId, txHash: output.txHash });
      return { success: true, noteId };
    } catch (err) {
      console.error("[epoch] createBridgeP2IDNote (requestSend) failed", err);
      return { success: false };
    }
  };
}

/**
 * Hook returning the `createMidenP2IDNote` callback for the connected MidenFi
 * wallet, or `null` when the wallet is disconnected or its adapter doesn't
 * support `requestSend` / `waitForTransaction`. Pass the result straight into
 * `buildCrossChainIntent({ collateralType: "miden", createMidenP2IDNote })`.
 */
export function useCreateBridgeP2IDNote(): CreateMidenP2IDNote | null {
  const { requestSend, waitForTransaction, address, connected } = useMidenFiWallet();
  return useMemo(() => {
    if (!connected || !address || !requestSend || !waitForTransaction) return null;
    return createBridgeP2IDNoteCallback({ requestSend, waitForTransaction, senderAddress: address });
  }, [connected, address, requestSend, waitForTransaction]);
}
