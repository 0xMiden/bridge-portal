import { Buffer } from "buffer";
import { BN, BorshInstructionCoder, Program, type Idl, utils } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Transaction, VersionedTransaction, Keypair, Connection } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, unpackAccount, unpackMint } from "@solana/spl-token";
import idl from "./idl/token-messenger-minter-v2.json";
import type { HelperIdentity } from "../../../config/cctp-helper";
import type { SourceAuthorization } from "./helper-types";
import { assertManualAmounts, encodeHelperHook } from "./helper-hook";
import { z } from "zod";

// Exact published Anchor 0.31 IDL, SHA256 checked by the provenance regression.
const instructionOnlyConnection = new Connection("https://example.invalid", { fetch: async () => { throw new Error("IDL coding must not make RPC requests."); } });
export const circleProgram = (owner = PublicKey.default) => new Program(idl as Idl, { publicKey: owner, connection: instructionOnlyConnection });
const pda = (program: PublicKey, ...seeds: (string | Uint8Array)[]) =>
  PublicKey.findProgramAddressSync(seeds.map(seed => typeof seed === "string" ? Buffer.from(seed) : seed), program)[0];

export function helperSolanaAccounts(deployment: HelperIdentity, sourceAccount: string, eventAccount: string) {
  const owner = new PublicKey(sourceAccount), mint = new PublicKey(deployment.source.mint);
  const program = new PublicKey(deployment.source.tokenMessengerProgram), transmitter = new PublicKey(deployment.source.messageTransmitterProgram);
  return { owner, eventRentPayer: owner, senderAuthorityPda: pda(program, "sender_authority"),
    burnTokenAccount: getAssociatedTokenAddressSync(mint, owner), denylistAccount: pda(program, "denylist_account", owner.toBytes()),
    messageTransmitter: pda(transmitter, "message_transmitter"), tokenMessenger: pda(program, "token_messenger"),
    remoteTokenMessenger: pda(program, "remote_token_messenger", "26"), tokenMinter: pda(program, "token_minter"),
    localToken: pda(program, "local_token", mint.toBytes()), burnTokenMint: mint, messageSentEventData: new PublicKey(eventAccount),
    messageTransmitterProgram: transmitter, tokenMessengerMinterProgram: program, tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId, eventAuthority: pda(program, "__event_authority"), program };
}

export async function buildHelperSolanaInstruction(auth: SourceAuthorization, eventAccount: string) {
  assertManualAmounts(auth);
  const accounts = helperSolanaAccounts(auth.deployment, auth.sourceAccount, eventAccount);
  const helper = new PublicKey(Buffer.from(auth.deployment.helper.address.slice(2).padStart(64, "0"), "hex"));
  return circleProgram(accounts.owner).methods.depositForBurnWithHook({
    amount: new BN(auth.grossAmount), destinationDomain: 26, mintRecipient: helper, destinationCaller: helper,
    maxFee: new BN(auth.maxCctpFee), minFinalityThreshold: 2000, hookData: Buffer.from(encodeHelperHook(auth.midenRecipient).slice(2), "hex"),
  }).accountsStrict(accounts).instruction();
}

export async function readSolanaBalances(connection: Connection, deployment: HelperIdentity, owner: string) {
  const accounts = helperSolanaAccounts(deployment, owner, PublicKey.default.toBase58());
  const [mintInfo, tokenInfo, lamports] = await Promise.all([
    connection.getAccountInfo(accounts.burnTokenMint, "confirmed"), connection.getAccountInfo(accounts.burnTokenAccount, "confirmed"),
    connection.getBalance(accounts.owner, "confirmed"),
  ]);
  const mint = unpackMint(accounts.burnTokenMint, mintInfo, TOKEN_PROGRAM_ID);
  if (mint.decimals !== 6 || !mint.isInitialized) throw new Error("Invalid source mint or SOL balance.");
  if (!Number.isSafeInteger(lamports) || lamports < 0) throw new Error("Invalid source mint or SOL balance.");
  if (!tokenInfo) return { amount: 0n, lamports: BigInt(lamports), ataPresent: false };
  const token = unpackAccount(accounts.burnTokenAccount, tokenInfo, TOKEN_PROGRAM_ID);
  if (!token.owner.equals(accounts.owner) || !token.mint.equals(accounts.burnTokenMint)) throw new Error("The ordinary USDC token account is unavailable.");
  if (!token.isInitialized || token.isFrozen) throw new Error("The ordinary USDC token account is unavailable.");
  return { amount: token.amount, lamports: BigInt(lamports), ataPresent: true };
}

export async function prepareHelperSolana(connection: Connection, auth: SourceAuthorization) {
  const event = Keypair.generate();
  const [validity, slot, balances, rent] = await Promise.all([
    connection.getLatestBlockhash("confirmed"), connection.getSlot("finalized"), readSolanaBalances(connection, auth.deployment, auth.sourceAccount),
    // MessageSent: discriminator8 + rent_payer32 + created_at8 + vector length4 + message440.
    connection.getMinimumBalanceForRentExemption(492, "confirmed"),
  ]);
  if (!balances.ataPresent || balances.amount < BigInt(auth.grossAmount)) throw new Error("Insufficient USDC in your ordinary Solana USDC account.");
  const transaction = new Transaction({ feePayer: new PublicKey(auth.sourceAccount), ...validity });
  transaction.add(await buildHelperSolanaInstruction(auth, event.publicKey.toBase58()));
  const fee = (await connection.getFeeForMessage(transaction.compileMessage(), "confirmed")).value;
  if (fee === null || [fee, rent, slot, validity.lastValidBlockHeight].some(value => !Number.isSafeInteger(value)))
    throw new Error("Source fee, rent or validity is unavailable.");
  if ([fee, rent, slot, validity.lastValidBlockHeight].some(value => value < 0)) throw new Error("Invalid source validity or cost.");
  if (balances.lamports < BigInt(fee) + BigInt(rent)) throw new Error("Not enough SOL for the transaction fee and Circle event-account rent.");
  const simulation = await connection.simulateTransaction(new VersionedTransaction(transaction.compileMessage()), { sigVerify: false, replaceRecentBlockhash: false, commitment: "confirmed" });
  if (simulation.value.err) throw new Error("The exact Solana burn simulation failed.");
  transaction.partialSign(event);
  if (transaction.serialize({ requireAllSignatures: false }).length > 1232) throw new Error("Solana transaction exceeds the packet limit.");
  return { transaction, eventAccount: event.publicKey.toBase58(), scanStartSlot: String(slot), blockhash: validity.blockhash,
    lastValidBlockHeight: String(validity.lastValidBlockHeight), sourceFeeLamports: String(fee), eventRentLamports: String(rent) };
}

export function verifySignedSolana(originalMessage: Uint8Array, signed: Transaction, owner: string, eventAccount: string) {
  if (!Buffer.from(originalMessage).equals(signed.serializeMessage()) || signed.feePayer?.toBase58() !== owner)
    throw new Error("Phantom changed the reviewed transaction.");
  if (signed.signatures.length !== 2 || !signed.signatures.some(entry => entry.publicKey.toBase58() === eventAccount) || !signed.verifySignatures())
    throw new Error("Both the wallet and event-account signatures must remain valid.");
  const bytes = signed.serialize();
  if (bytes.length > 1232 || !signed.signature) throw new Error("Invalid signed Solana transaction.");
  return { signedBytes: bytes.toString("base64"), signature: utils.bytes.bs58.encode(signed.signature) };
}

/** Decode and reconstruct the exact supported legacy writer before proxying or replaying bytes. */
export async function validateHelperTransactionBytes(bytes: Uint8Array, deployment: HelperIdentity, requireSignatures: boolean) {
  if (bytes.length > 1232) throw new Error("Solana packet is too large.");
  const transaction = Transaction.from(bytes), ix = transaction.instructions[0];
  if (transaction.instructions.length !== 1 || !transaction.feePayer || !transaction.recentBlockhash) throw new Error("Only the reviewed Circle burn is supported.");
  if (ix?.keys.length !== 18 || ix.programId.toBase58() !== deployment.source.tokenMessengerProgram) throw new Error("Only the reviewed Circle burn is supported.");
  const decoded = new BorshInstructionCoder(circleProgram().idl).decode(ix.data);
  if (decoded?.name !== "depositForBurnWithHook") throw new Error("Unsupported source instruction.");
  const { params } = z.object({ params: z.object({ amount: z.instanceof(BN), destinationDomain: z.literal(26), mintRecipient: z.instanceof(PublicKey),
    destinationCaller: z.instanceof(PublicKey), maxFee: z.instanceof(BN), minFinalityThreshold: z.literal(2000), hookData: z.instanceof(Buffer) }) }).parse(decoded.data);
  const hook = params.hookData.toString("hex"), recipient = `0x${hook.slice(64)}` as const;
  if (`0x${hook}` !== encodeHelperHook(recipient)) throw new Error("Source hook mismatch.");
  const authorization: SourceAuthorization = { execution: "manual", deployment, deploymentId: deployment.deploymentId, sourceDomain: 5,
    sourceAccount: transaction.feePayer.toBase58(), grossAmount: params.amount.toString(), maxCctpFee: params.maxFee.toString(),
    minimumNet: params.amount.sub(params.maxFee).toString(), midenRecipient: recipient, checkedAt: new Date(0).toISOString(), finality: 2000 };
  const eventAccount = ix.keys[11].pubkey.toBase58();
  const expected = new Transaction({ feePayer: transaction.feePayer, recentBlockhash: transaction.recentBlockhash })
    .add(await buildHelperSolanaInstruction(authorization, eventAccount));
  if (!expected.serializeMessage().equals(transaction.serializeMessage())) throw new Error("Source instruction does not match the deployment.");
  if (requireSignatures) verifySignedSolana(expected.serializeMessage(), transaction, authorization.sourceAccount, eventAccount);
  return { transaction, authorization, eventAccount };
}
