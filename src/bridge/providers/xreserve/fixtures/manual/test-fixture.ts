import { Buffer } from "buffer";
import { createHash } from "node:crypto";
import { Keypair, PublicKey, Transaction, SystemProgram } from "@solana/web3.js";
import { BN, utils } from "@coral-xyz/anchor";
import { helperDeploymentSchema } from "../../../../../config/cctp-helper";
import deploymentJson from "./deployment.json";
import golden from "./solana-golden.json";
import { buildHelperSolanaInstruction, circleProgram } from "../../helper-solana";
import type { ManualAuthorization } from "../../helper-types";

export const deployment = helperDeploymentSchema.parse(deploymentJson[0]);
export const owner = Keypair.fromSeed(new Uint8Array(32).fill(1));
export const event = Keypair.fromSeed(new Uint8Array(32).fill(2));
export const recipient = golden.miden.bytes32 as `0x${string}`;
export function authorization(): ManualAuthorization {
  return { execution: "manual", sourceDomain: 5, sourceAccount: owner.publicKey.toBase58(), deployment, deploymentId: deployment.deploymentId,
    grossAmount: "1000000", maxCctpFee: "100", minimumNet: "999900", midenRecipient: recipient, checkedAt: new Date().toISOString(), finality: 2000 };
}
const uint = (number: number | bigint | string, size: number, little = false) => {
  const value = Buffer.from(BigInt(number).toString(16).padStart(size * 2, "0"), "hex");
  return little ? value.reverse() : value;
};
const evm = (address: string) => Buffer.from(address.slice(2).padStart(64, "0"), "hex");
const tag = (value: string) => createHash("sha256").update(value).digest().subarray(0, 8);

export async function signedFixture(auth = authorization()) {
  const ix = await buildHelperSolanaInstruction(auth, event.publicKey.toBase58());
  const transaction = new Transaction({ feePayer: owner.publicKey, recentBlockhash: PublicKey.default.toBase58() }).add(ix);
  transaction.partialSign(event, owner);
  const message = transaction.compileMessage(), keys = message.accountKeys.map(key => key.toBase58());
  const keyIndex = (value: PublicKey) => keys.indexOf(value.toBase58());
  const hook = ix.data.subarray(100);
  const body = Buffer.concat([uint(1, 4), new PublicKey(deployment.source.mint).toBuffer(), evm(deployment.helper.address), uint(auth.grossAmount, 32),
    owner.publicKey.toBuffer(), uint(auth.maxCctpFee, 32), uint(0, 32), uint(0, 32), hook]);
  const sourceMessage = Buffer.concat([uint(1, 4), uint(5, 4), uint(26, 4), uint(0, 32), ix.programId.toBuffer(), evm(deployment.arc.tokenMessenger.address),
    evm(deployment.helper.address), uint(2000, 4), uint(0, 4), body]);
  const send = Buffer.concat([tag("global:send_message"), uint(26, 4, true), evm(deployment.arc.tokenMessenger.address), evm(deployment.helper.address), uint(2000, 4, true), uint(body.length, 4, true), body]);
  const eventData = circleProgram().coder.types.encode("depositForBurn", { burnToken: new PublicKey(deployment.source.mint), amount: new BN(auth.grossAmount), depositor: owner.publicKey,
    mintRecipient: new PublicKey(evm(deployment.helper.address)), destinationDomain: 26, destinationTokenMessenger: new PublicKey(evm(deployment.arc.tokenMessenger.address)),
    destinationCaller: new PublicKey(evm(deployment.helper.address)), maxFee: new BN(auth.maxCctpFee), minFinalityThreshold: 2000, hookData: hook });
  const emitted = Buffer.concat([Buffer.from("e445a52e51cb9a1d", "hex"), tag("event:DepositForBurn"), eventData]);
  const signature = utils.bytes.bs58.encode(transaction.signature!);
  const raw = { slot: 105, blockTime: 1700000000, version: "legacy" as const, transaction: { signatures: transaction.signatures.map(value => utils.bytes.bs58.encode(value.signature!)),
    message: { accountKeys: keys, header: message.header, recentBlockhash: message.recentBlockhash, instructions: message.instructions } },
  meta: { err: null as unknown, fee: 5000, preBalances: keys.map(() => 1000000000), postBalances: keys.map(() => 999995000), logMessages: [],
    preTokenBalances: [], postTokenBalances: [], rewards: [], innerInstructions: [{ index: 0, instructions: [
      { programIdIndex: keyIndex(SystemProgram.programId), accounts: [], data: "", stackHeight: 2 },
      { programIdIndex: keyIndex(new PublicKey(deployment.source.messageTransmitterProgram)), accounts: [1, 2, 5, 11, 13, 15].map(position => keyIndex(ix.keys[position].pubkey)), data: utils.bytes.bs58.encode(send), stackHeight: 2 },
      { programIdIndex: keyIndex(ix.programId), accounts: [keyIndex(ix.keys[16].pubkey)], data: utils.bytes.bs58.encode(emitted), stackHeight: 2 },
    ] }] } };
  return { transaction, raw, signature, sourceMessage: `0x${sourceMessage.toString("hex")}` as const, authorization: auth };
}
