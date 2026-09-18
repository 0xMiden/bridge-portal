import { NextResponse } from "next/server";

import { sepoliaRpc } from "../../../lib/sepolia-rpc";

type TransactionReceipt = {
  blockNumber: `0x${string}`;
  status: `0x${string}`;
  transactionHash: `0x${string}`;
};

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const hash = searchParams.get("hash") ?? "";

  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    return NextResponse.json({ error: "hash must be a 32-byte transaction hash." }, { status: 400 });
  }

  try {
    const receipt = await sepoliaRpc<TransactionReceipt | null>(
      "eth_getTransactionReceipt",
      [hash],
    );
    if (!receipt) {
      return NextResponse.json({
        hash,
        status: "pending",
        confirmations: 0,
      });
    }

    const latestBlockHex = await sepoliaRpc<`0x${string}`>("eth_blockNumber", []);
    const latestBlock = BigInt(latestBlockHex ?? "0x0");
    const receiptBlock = BigInt(receipt.blockNumber);
    const confirmations = latestBlock >= receiptBlock ? Number(latestBlock - receiptBlock + 1n) : 0;

    return NextResponse.json({
      hash: receipt.transactionHash,
      status: "confirmed",
      blockNumber: receipt.blockNumber,
      confirmations,
      success: receipt.status === "0x1",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to read Sepolia transaction status." },
      { status: 502 },
    );
  }
}
