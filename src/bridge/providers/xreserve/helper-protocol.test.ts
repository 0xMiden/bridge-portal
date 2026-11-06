import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Keypair, Transaction } from "@solana/web3.js";
import { CIRCLE_SOLANA_IDL_HASH, helperDeployments, helperDeploymentSchema, solanaKey, solanaSignature } from "../../../config/cctp-helper";
import { assertEmbeddedRecipient, assertManualAmounts, encodeHelperHook, requiredManualFee } from "./helper-hook";
import { buildHelperSolanaInstruction, validateHelperTransactionBytes, verifySignedSolana } from "./helper-solana";
import { HELPER_MAX } from "./helper-types";
import { assertFreshManualQuote } from "./helper-manual";
import { authorization, deployment, event, owner, signedFixture } from "./fixtures/manual/test-fixture";
import golden from "./fixtures/manual/solana-golden.json";
import vectors from "./fixtures/manual/recipient-boundaries.json";
import { routesForEnvironment } from "../../core/routes";

describe("manual deployment, exact codecs and fees", () => {
  it("keeps all release routes disabled and no live helper defaults", () => {
    expect(helperDeployments).toEqual([]);
    for (const environment of ["testnet", "mainnet"] as const) {
      const routes = routesForEnvironment(environment).filter(route => route.transport === "cctp-helper");
      expect(routes).toHaveLength(1); expect(routes[0].disabled).toBe(true); expect(routes[0].helperDeployment).toBeUndefined();
    }
    expect(() => helperDeploymentSchema.parse({ ...deployment, environment: "mainnet" })).toThrow();
  });
  it("uses the unmodified pinned Circle IDL", () => {
    const raw = readFileSync(new URL("./idl/token-messenger-minter-v2.json", import.meta.url));
    expect(createHash("sha256").update(raw).digest("hex")).toBe(CIRCLE_SOLANA_IDL_HASH);
  });
  it.each(vectors.cases)("matches released Rust recipient boundary $id", test => {
    if (test.accepted) expect(() => assertEmbeddedRecipient(test.bytes32)).not.toThrow();
    else expect(() => assertEmbeddedRecipient(test.bytes32)).toThrow();
  });
  it("matches the canonical ABI hook and exact IDL metas", async () => {
    expect(encodeHelperHook(golden.miden.bytes32)).toBe(golden.hook);
    const ix = await buildHelperSolanaInstruction(authorization(), event.publicKey.toBase58());
    expect(ix.data.toString("hex")).toBe(golden.instructionHex);
    expect(ix.keys.map((value, index) => ({ name: golden.accounts[index].name, address: value.pubkey.toBase58(), isSigner: value.isSigner, isWritable: value.isWritable }))).toEqual(golden.accounts);
  });
  it("validates exact base58 lengths including leading zero signatures", () => {
    expect(solanaSignature.parse("1".repeat(64))).toBe("1".repeat(64));
    expect(solanaKey.parse("1".repeat(32))).toBe("1".repeat(32));
    for (const value of ["1".repeat(63), "1".repeat(65), "0".repeat(88)]) expect(solanaSignature.safeParse(value).success).toBe(false);
  });
  it("uses decimal-bps ceiling and exact Solana min_fee floor/minimum", () => {
    expect(requiredManualFee(1_000_001n, "0.0001", 0)).toBe(1n);
    expect(requiredManualFee(10_000_001n, "0.1", 1000)).toBe(1000n);
    expect(requiredManualFee(2n, "0", 1)).toBe(1n);
    expect(() => requiredManualFee(1n, "0", 1)).toThrow();
    expect(() => requiredManualFee(100n, "10000", 0)).toThrow();
  });
  it("enforces gross Miden maximum, exact net and positive principal", () => {
    expect(() => assertManualAmounts({ grossAmount: HELPER_MAX.toString(), maxCctpFee: "0", minimumNet: HELPER_MAX.toString() })).not.toThrow();
    for (const quote of [{ grossAmount: (HELPER_MAX + 1n).toString(), maxCctpFee: "1", minimumNet: HELPER_MAX.toString() },
      { grossAmount: "1", maxCctpFee: "1", minimumNet: "0" }, { grossAmount: "10", maxCctpFee: "1", minimumNet: "10" }]) expect(() => assertManualAmounts(quote)).toThrow();
  });
  it("requires renewed review on stale quote, fee increase or any immutable change", () => {
    const auth = authorization();
    expect(() => assertFreshManualQuote(auth, { ...auth, maxCctpFee: "99", minimumNet: "999901" })).not.toThrow();
    for (const patch of [{ sourceAccount: event.publicKey.toBase58() }, { deploymentId: "changed" }, { midenRecipient: `0x${"00".repeat(32)}` as const },
      { grossAmount: "2000000", minimumNet: "1999900" }, { maxCctpFee: "101", minimumNet: "999899" }, { checkedAt: new Date(Date.now() - 31_000).toISOString() }])
      expect(() => assertFreshManualQuote(auth, { ...auth, ...patch })).toThrow();
  });
});

describe("real legacy source signing and replay guards", () => {
  it("roundtrips a genuine two-signature packet and full reviewed instruction", async () => {
    const fixture = await signedFixture();
    expect(fixture.transaction.serialize()).toHaveLength(864);
    const restored = await validateHelperTransactionBytes(fixture.transaction.serialize(), deployment, true);
    expect(restored.authorization.grossAmount).toBe("1000000");
    expect(verifySignedSolana(fixture.transaction.serializeMessage(), restored.transaction, owner.publicKey.toBase58(), event.publicKey.toBase58()).signature).toBe(fixture.signature);
  });
  it.each(["message", "event", "wallet"])("rejects changed %s bytes/signature", async mutation => {
    const { transaction } = await signedFixture(); const original = transaction.serializeMessage();
    const mutated = Transaction.from(transaction.serialize());
    if (mutation === "message") { mutated.recentBlockhash = Keypair.fromSeed(new Uint8Array(32).fill(3)).publicKey.toBase58(); mutated.partialSign(event, owner); }
    else mutated.signatures[mutation === "wallet" ? 0 : 1].signature = Buffer.alloc(64);
    expect(() => verifySignedSolana(original, mutated, owner.publicKey.toBase58(), event.publicKey.toBase58())).toThrow();
  });
  it("rejects a validly signed transaction for a different helper deployment", async () => {
    const fixture = await signedFixture();
    await expect(validateHelperTransactionBytes(fixture.transaction.serialize(), { ...deployment, helper: { ...deployment.helper, address: "0x7777777777777777777777777777777777777777" } }, true)).rejects.toThrow();
  });
});
