import { Buffer } from "buffer";
import { BN, utils } from "@coral-xyz/anchor";
import { PublicKey, type AccountMeta } from "@solana/web3.js";
import { concatHex, numberToHex, pad, sha256, toHex, type Hex } from "viem";
import { z } from "zod";
import type { HelperIdentity } from "../../config/cctp-helper";
import { buildHelperSolanaInstruction, circleProgram, helperSolanaAccounts } from "../providers/xreserve/helper-solana";
import { assertManualAmounts, encodeHelperHook } from "../providers/xreserve/helper-hook";
import type { SourceAuthorization, ManualSourceEvidence } from "../providers/xreserve/helper-types";
import { decodeCctpMessage } from "../providers/xreserve/cctp-message";
import { assertSolanaGenesis, createSolanaConnection, resolvedSolanaKeys, type RawSolanaTransaction } from "./rpc";

const eventTag = "e445a52e51cb9a1d"; // Anchor 0.31 EVENT_IX_TAG_LE, followed by the IDL event discriminator.
const sendTag = sha256(toHex("global:send_message")).slice(2, 18);
const keyHex = (key: PublicKey): Hex => toHex(key.toBytes());
const eventSchema = z.object({ burnToken: z.instanceof(PublicKey), amount: z.instanceof(BN), depositor: z.instanceof(PublicKey),
  mintRecipient: z.instanceof(PublicKey), destinationDomain: z.literal(26), destinationTokenMessenger: z.instanceof(PublicKey),
  destinationCaller: z.instanceof(PublicKey), maxFee: z.instanceof(BN), minFinalityThreshold: z.literal(2000), hookData: z.instanceof(Buffer) });
type BurnEvent = z.infer<typeof eventSchema>;
type SourceInstruction = RawSolanaTransaction["transaction"]["message"]["instructions"][number];
type InnerGroup = NonNullable<RawSolanaTransaction["meta"]["innerInstructions"]>[number];
type SourceAccounts = ReturnType<typeof helperSolanaAccounts>;
type BurnOccurrence = { inner: SourceInstruction; ordinal: number; data: BurnEvent };

/** Decode lazily so each event is fully authenticated before inspecting the next occurrence. */
function* sourceBurnEvents(group: InnerGroup, keys: string[], tokenMessengerProgram: string): Generator<BurnOccurrence> {
  for (const [ordinal, inner] of group.instructions.entries()) {
    if (keys[inner.programIdIndex] !== tokenMessengerProgram) continue;
    const bytes = Buffer.from(utils.bytes.bs58.decode(inner.data));
    if (bytes.subarray(0, 8).toString("hex") !== eventTag) continue;
    const event = circleProgram().coder.events.decode(bytes.subarray(8).toString("base64"));
    if (event?.name !== "depositForBurn") continue;
    yield { inner, ordinal, data: eventSchema.parse(event.data) };
  }
}

function sourceAuthorization(data: BurnEvent, deployment: HelperIdentity) {
  const hook = toHex(data.hookData);
  if (hook.length !== 130) throw new Error("Invalid source hook.");
  const recipient = `0x${hook.slice(66)}` as Hex;
  if (encodeHelperHook(recipient) !== hook) throw new Error("Invalid source recipient hook.");
  const auth: SourceAuthorization = { execution: "manual", deploymentId: deployment.deploymentId, deployment, sourceDomain: 5,
    sourceAccount: data.depositor.toBase58(), grossAmount: data.amount.toString(), maxCctpFee: data.maxFee.toString(),
    minimumNet: data.amount.sub(data.maxFee).toString(), midenRecipient: recipient, checkedAt: new Date(0).toISOString(), finality: 2000 };
  assertManualAmounts(auth);
  return { auth, hook };
}

function assertEventDeployment(data: BurnEvent, deployment: HelperIdentity) {
  if (keyHex(data.burnToken) !== keyHex(new PublicKey(deployment.source.mint)) || keyHex(data.mintRecipient) !== pad(deployment.helper.address))
    throw new Error("Source event deployment mismatch.");
  if (keyHex(data.destinationCaller) !== pad(deployment.helper.address) || keyHex(data.destinationTokenMessenger) !== pad(deployment.arc.tokenMessenger.address))
    throw new Error("Source event deployment mismatch.");
}

function sourceAccountWritable(tx: RawSolanaTransaction, accountIndex: number) {
  const { accountKeys, header } = tx.transaction.message;
  if (accountIndex < header.numRequiredSignatures) return accountIndex < header.numRequiredSignatures - header.numReadonlySignedAccounts;
  if (accountIndex < accountKeys.length) return accountIndex < accountKeys.length - header.numReadonlyUnsignedAccounts;
  return accountIndex < accountKeys.length + (tx.meta.loadedAddresses?.writable.length ?? 0);
}

function assertSourceAccountMetas(tx: RawSolanaTransaction, parent: SourceInstruction, expected: AccountMeta[]) {
  for (const [position, key] of expected.entries()) {
    const accountIndex = parent.accounts[position];
    if (key.isSigner && accountIndex >= tx.transaction.message.header.numRequiredSignatures) throw new Error("Missing source signer.");
    const writable = sourceAccountWritable(tx, accountIndex);
    if (key.isWritable && !writable) throw new Error("Missing writable source account.");
  }
}

async function validateSourceParent(tx: RawSolanaTransaction, keys: string[], group: InnerGroup, auth: SourceAuthorization) {
  const parent = tx.transaction.message.instructions[group.index];
  if (keys[parent.programIdIndex] !== auth.deployment.source.tokenMessengerProgram || parent.accounts.length !== 18) throw new Error("Unverified source instruction.");
  const eventAccount = keys[parent.accounts[11]], expected = await buildHelperSolanaInstruction(auth, eventAccount);
  if (!Buffer.from(utils.bytes.bs58.decode(parent.data)).equals(expected.data) || expected.keys.some((key, position) => key.pubkey.toBase58() !== keys[parent.accounts[position]]))
    throw new Error("Source instruction/account mismatch.");
  assertSourceAccountMetas(tx, parent, expected.keys);
  return eventAccount;
}

function sourceMessage(group: InnerGroup, keys: string[], deployment: HelperIdentity, accounts: SourceAccounts) {
  const sends = group.instructions.filter(ix => keys[ix.programIdIndex] === deployment.source.messageTransmitterProgram &&
    Buffer.from(utils.bytes.bs58.decode(ix.data)).subarray(0, 8).toString("hex") === sendTag);
  if (sends.length !== 1) throw new Error("Ambiguous source message occurrence.");
  const send = sends[0], raw = Buffer.from(utils.bytes.bs58.decode(send.data));
  const sendAccounts = [accounts.eventRentPayer, accounts.senderAuthorityPda, accounts.messageTransmitter, accounts.messageSentEventData, accounts.program, accounts.systemProgram];
  if (send.accounts.length !== 6 || sendAccounts.some((key, index) => key.toBase58() !== keys[send.accounts[index]]) || raw.length !== 376)
    throw new Error("Source transmitter CPI mismatch.");
  if (raw.readUInt32LE(8) !== 26 || toHex(raw.subarray(12, 44)) !== pad(deployment.arc.tokenMessenger.address) ||
      toHex(raw.subarray(44, 76)) !== pad(deployment.helper.address)) throw new Error("Source transmitter CPI mismatch.");
  if (raw.readUInt32LE(76) !== 2000 || raw.readUInt32LE(80) !== 292) throw new Error("Source transmitter CPI mismatch.");
  return concatHex([numberToHex(1, { size: 4 }), numberToHex(5, { size: 4 }), numberToHex(26, { size: 4 }), numberToHex(0, { size: 32 }),
    keyHex(accounts.program), pad(deployment.arc.tokenMessenger.address), pad(deployment.helper.address), numberToHex(2000, { size: 4 }), numberToHex(0, { size: 4 }), toHex(raw.subarray(84))]);
}

function assertBurnBody(message: Hex, data: BurnEvent, hook: Hex) {
  const decoded = decodeCctpMessage(message).transfer;
  if (decoded.burnVersion !== 1 || decoded.burnToken !== keyHex(data.burnToken) || decoded.mintRecipient !== keyHex(data.mintRecipient))
    throw new Error("Source burn body/event mismatch.");
  if (decoded.messageSender !== keyHex(data.depositor) || decoded.amount !== BigInt(data.amount.toString()) || decoded.maxFee !== BigInt(data.maxFee.toString()))
    throw new Error("Source burn body/event mismatch.");
  if (decoded.hookData !== hook) throw new Error("Source burn body/event mismatch.");
}

async function validateSourceOccurrence(tx: RawSolanaTransaction, deployment: HelperIdentity, keys: string[], signature: string, group: InnerGroup, occurrence: BurnOccurrence): Promise<ManualSourceEvidence> {
  const { data, inner, ordinal } = occurrence, { auth, hook } = sourceAuthorization(data, deployment);
  assertEventDeployment(data, deployment);
  const eventAccount = await validateSourceParent(tx, keys, group, auth);
  const accounts = helperSolanaAccounts(deployment, auth.sourceAccount, eventAccount);
  if (keys[0] !== auth.sourceAccount || inner.accounts.length !== 1 || keys[inner.accounts[0]] !== accounts.eventAuthority.toBase58())
    throw new Error("Source fee payer or event authority mismatch.");
  const message = sourceMessage(group, keys, deployment, accounts);
  assertBurnBody(message, data, hook);
  return { sourceTransaction: signature, slot: String(tx.slot), sourceEventIds: [`solana:${signature}:${group.index}:${ordinal}`],
    eventAccount, sourceAccount: auth.sourceAccount, grossAmount: auth.grossAmount, maxCctpFee: auth.maxCctpFee, midenRecipient: auth.midenRecipient, message };
}

/** Authenticate actual self-CPI events and their parent IDL instruction, retaining full inner ordinals. */
export async function validateManualSource(tx: RawSolanaTransaction, deployment: HelperIdentity): Promise<ManualSourceEvidence> {
  if (tx.meta.err !== null) throw new Error("Source transaction did not succeed.");
  if (BigInt(tx.slot) < BigInt(deployment.source.startSlot)) throw new Error("Source precedes the qualified deployment range.");
  const keys = resolvedSolanaKeys(tx), signature = tx.transaction.signatures[0], matches: ManualSourceEvidence[] = [];
  for (const group of tx.meta.innerInstructions ?? []) {
    for (const occurrence of sourceBurnEvents(group, keys, deployment.source.tokenMessengerProgram)) {
      matches.push(await validateSourceOccurrence(tx, deployment, keys, signature, group, occurrence));
    }
  }
  if (matches.length !== 1) throw new Error(matches.length ? "Ambiguous source occurrences." : "Expected source burn was not found.");
  return matches[0];
}

export async function readFinalizedManualSource(deployment: HelperIdentity, endpoint: string, signature: string) {
  let raw: RawSolanaTransaction | undefined;
  const connection = createSolanaConnection(deployment, endpoint, value => { raw = value; });
  await assertSolanaGenesis(connection, deployment);
  const statuses = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
  const status = statuses.value[0];
  if (!status || status.confirmationStatus !== "finalized") return { state: "pending" as const };
  await connection.getTransaction(signature, { commitment: "finalized", maxSupportedTransactionVersion: 1 });
  if (!raw || raw.slot !== status.slot || (await connection.getSlot("finalized")) < raw.slot) throw new Error("Finalized source history unavailable.");
  if (JSON.stringify(raw.meta.err) !== JSON.stringify(status.err)) throw new Error("Contradictory source execution result.");
  if (raw.meta.err !== null) return { state: "source_failed" as const, sourceTransaction: signature, slot: String(raw.slot), error: JSON.stringify(raw.meta.err).slice(0, 400) };
  return { state: "finalized" as const, source: await validateManualSource(raw, deployment) };
}
