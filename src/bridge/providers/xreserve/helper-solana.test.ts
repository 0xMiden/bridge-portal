import { describe, expect, it, vi } from "vitest";
import { Connection, PublicKey, type AccountInfo } from "@solana/web3.js";
import { AccountLayout, MintLayout, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { authorization, deployment, event, owner } from "./fixtures/manual/test-fixture";
import { prepareHelperSolana } from "./helper-solana";

function sourceFixture(options: { amount?: bigint; sol?: number; absent?: boolean; frozen?: boolean; wrongOwner?: boolean; wrongMint?: boolean; decimals?: number } = {}) {
  const connection = new Connection("https://example.invalid"), mint = new PublicKey(deployment.source.mint), zero = PublicKey.default;
  const mintData = Buffer.alloc(MintLayout.span), tokenData = Buffer.alloc(AccountLayout.span);
  MintLayout.encode({ mintAuthorityOption: 0, mintAuthority: zero, supply: 10_000_000_000n, decimals: options.decimals ?? 6,
    isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: zero }, mintData);
  AccountLayout.encode({ mint: options.wrongMint ? event.publicKey : mint, owner: options.wrongOwner ? event.publicKey : owner.publicKey,
    amount: options.amount ?? 1_000_000n, delegateOption: 0, delegate: zero, state: options.frozen ? 2 : 1, isNativeOption: 0,
    isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: zero }, tokenData);
  const account = (data: Buffer): AccountInfo<Buffer> => ({ data, owner: TOKEN_PROGRAM_ID, executable: false, lamports: 1000000, rentEpoch: 0 });
  vi.spyOn(connection, "getAccountInfo").mockImplementation(async key => key.equals(mint) ? account(mintData) : options.absent ? null : account(tokenData));
  vi.spyOn(connection, "getBalance").mockResolvedValue(options.sol ?? 1_005_000);
  const blockhash = vi.spyOn(connection, "getLatestBlockhash").mockResolvedValue({ blockhash: zero.toBase58(), lastValidBlockHeight: 200 });
  const slot = vi.spyOn(connection, "getSlot").mockResolvedValue(100);
  const rent = vi.spyOn(connection, "getMinimumBalanceForRentExemption").mockResolvedValue(1_000_000);
  const fee = vi.spyOn(connection, "getFeeForMessage").mockResolvedValue({ context: { slot: 100 }, value: 5000 });
  const simulation = vi.spyOn(connection, "simulateTransaction").mockResolvedValue({ context: { slot: 100 }, value: { err: null, logs: [] } });
  return { connection, blockhash, slot, rent, fee, simulation };
}

describe("actual SPL account and source preparation boundary", () => {
  it("allows exact USDC principal and exact SOL fee plus event rent, preserving only event signature", async () => {
    const fixture = sourceFixture(), prepared = await prepareHelperSolana(fixture.connection, authorization());
    expect(prepared.sourceFeeLamports).toBe("5000"); expect(prepared.eventRentLamports).toBe("1000000");
    expect(prepared.transaction.signatures.filter(value => value.signature)).toHaveLength(1);
    expect(prepared.transaction.signatures.find(value => value.signature)?.publicKey.toBase58()).toBe(prepared.eventAccount);
    expect(fixture.rent).toHaveBeenCalledWith(492, "confirmed");
    expect(fixture.simulation).toHaveBeenCalledWith(expect.anything(), { sigVerify: false, replaceRecentBlockhash: false, commitment: "confirmed" });
  });
  it.each([{ amount: 999999n }, { sol: 1004999 }, { absent: true }, { frozen: true }, { wrongOwner: true }, { wrongMint: true }, { decimals: 9 }, { sol: -1 }, { sol: Number.MAX_SAFE_INTEGER + 1 }])(
    "rejects invalid or insufficient balances case %# before simulation", async options => {
      const fixture = sourceFixture(options);
      await expect(prepareHelperSolana(fixture.connection, authorization())).rejects.toThrow();
      expect(fixture.simulation).not.toHaveBeenCalled();
    });
  it.each(["fee", "rent", "slot", "height"] as const)("rejects negative/unsafe %s from RPC", async field => {
    for (const value of [-1, Number.MAX_SAFE_INTEGER + 1]) {
      const fixture = sourceFixture();
      if (field === "fee") fixture.fee.mockResolvedValue({ context: { slot: 100 }, value });
      else if (field === "height") fixture.blockhash.mockResolvedValue({ blockhash: PublicKey.default.toBase58(), lastValidBlockHeight: value });
      else fixture[field].mockResolvedValue(value);
      await expect(prepareHelperSolana(fixture.connection, authorization())).rejects.toThrow();
      expect(fixture.simulation).not.toHaveBeenCalled();
    }
  });
  it("rejects source simulation failure", async () => {
    const fixture = sourceFixture(); fixture.simulation.mockResolvedValue({ context: { slot: 100 }, value: { err: "InstructionError", logs: [] } });
    await expect(prepareHelperSolana(fixture.connection, authorization())).rejects.toThrow("simulation failed");
  });
});
