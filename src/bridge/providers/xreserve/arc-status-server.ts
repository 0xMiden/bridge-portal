import { createPublicClient, parseEventLogs } from "viem";
import { ARC, ARC_MAX_MIDEN_AMOUNT, arcTestnet, xReserveAbi } from "./config";
import { evmServerTransport } from "../../evm/rpc.server";
import { decodeArcRecipient, parseArcDepositIntent } from "./attestation";

export async function getArcDepositStatus(hash: string) {
  if (!/^0x[\da-f]{64}$/i.test(hash))
    return Response.json({ error: "Invalid deposit hash." }, { status: 400 });
  try {
    const client = createPublicClient({ chain: arcTestnet, transport: evmServerTransport("arc-testnet") });
    const receipt = await client.getTransactionReceipt({ hash: hash as `0x${string}` })
      .catch((error: Error) => {
        if (error.name === "TransactionReceiptNotFoundError") return null;
        throw error;
      });
    if (!receipt) return Response.json({ status: "submitted" });
    if (receipt.status === "reverted") return Response.json({ status: "reverted" });

    // Anchor recovery and attestation matching to the actual xReserve event.
    // A successful unrelated transaction must never become a USDCx activity.
    const events = parseEventLogs({
      abi: xReserveAbi,
      eventName: "DepositedToRemote",
      logs: receipt.logs.filter((log) => log.address.toLowerCase() === ARC.xReserve.toLowerCase()),
    }).filter(({ args }) => args.remoteDomain === ARC.midenDomain &&
      args.localToken.toLowerCase() === ARC.usdc.toLowerCase());
    if (events.length !== 1)
      return Response.json({ error: "This transaction does not contain one supported Miden USDCx deposit." }, { status: 422 });
    const { args } = events[0];
    const deposit = {
      amount: args.value.toString(),
      recipient: decodeArcRecipient(args.remoteRecipient),
      faucet: decodeArcRecipient(args.remoteToken),
      sender: args.localDepositor.toLowerCase(),
    };
    if (deposit.faucet !== ARC.faucetId || args.value <= 0n || args.value > ARC_MAX_MIDEN_AMOUNT ||
        args.maxFee !== 0n || args.hookData !== "0x")
      return Response.json({ error: "This deposit targets a different faucet or unsupported deposit terms." }, { status: 422 });
    const block = await client.getBlock({ blockHash: receipt.blockHash });
    const sourceTxAt = Number(block.timestamp) * 1_000;

    try {
      const response = await fetch(`${ARC.attestationApi}/v1/attestations?txHash=${hash}`, {
        cache: "no-store", signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) throw new Error("Circle unavailable");
      const body = await response.json();
      let unreadable = false;
      for (const attestation of Array.isArray(body?.attestations) ? body.attestations : []) {
        if (!attestation || Number(attestation.remoteDomain) !== ARC.midenDomain ||
            typeof attestation.attestation !== "string" || !/^0x(?:[\da-f]{2})+$/i.test(attestation.attestation)) continue;
        try {
          const intent = parseArcDepositIntent(attestation.payload);
          if (intent.amount !== deposit.amount || intent.recipient !== deposit.recipient ||
              intent.faucet !== deposit.faucet || intent.sender !== deposit.sender) {
            unreadable = true;
            continue;
          }
          return Response.json({ status: "attested", deposit, sourceTxAt, intent });
        } catch {
          unreadable = true;
        }
      }
      return Response.json({ status: "confirmed", deposit, sourceTxAt, ...(unreadable ? {
        warning: "Circle returned details that do not match this deposit. Tracking will retry.",
      } : {}) });
    } catch {
      return Response.json({ status: "confirmed", deposit, sourceTxAt, warning: "Circle status unavailable. Tracking will retry." });
    }
  } catch {
    return Response.json({ error: "Unable to refresh this deposit. Keep its transaction hash; do not deposit again." }, { status: 502 });
  }
}
