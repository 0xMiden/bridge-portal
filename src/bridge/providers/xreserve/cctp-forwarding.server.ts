import { z } from "zod";
import { size, type Hex } from "viem";
import { hexDataSchema, transactionHashSchema } from "../../evm/evm-schema";
import { getCircleJson } from "./circle-http.server";
import { parseCirclePayload } from "./circle-schema";
import { decodeCctpMessage, matchAttestedMessage, type CctpMessage } from "./cctp-message";

// Iris can report a message before attestation or forwarding is available.
// https://developers.circle.com/api-reference/cctp/all/get-messages-v2
const messageSchema = z.object({
  message: hexDataSchema.or(z.literal("")).nullish(),
  forwardTxHash: transactionHashSchema.or(z.enum(["", "0x"])).nullish(),
});
const messagesSchema = z.object({ messages: z.array(messageSchema) });

export type CctpForwarding = { message: CctpMessage; transactionHash: Hex };

function decodeForwarding(entry: z.infer<typeof messageSchema>, source: CctpMessage): CctpForwarding | null {
  if (!entry.message || size(entry.message) !== source.byteLength) return null;
  if (!entry.forwardTxHash || entry.forwardTxHash === "0x") return null;
  return { message: decodeCctpMessage(entry.message), transactionHash: entry.forwardTxHash };
}

/** Circle suggests a transaction; immutable source-chain fields determine whether it belongs to this burn. */
export async function findCctpForwarding(api: string, hash: Hex, source: CctpMessage): Promise<CctpForwarding | null> {
  const body = await getCircleJson(`${api}/v2/messages/${source.transfer.sourceDomain}?transactionHash=${hash}`);
  if (body === undefined) return null;
  const { messages } = parseCirclePayload(messagesSchema, body, "Circle returned an invalid forwarding response.");
  const candidates = messages.map(entry => decodeForwarding(entry, source));
  return candidates.find(candidate => candidate !== null && matchAttestedMessage(source, candidate.message)) ?? null;
}
