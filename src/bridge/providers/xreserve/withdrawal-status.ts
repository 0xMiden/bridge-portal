import type { BridgeActivity } from "../../core/models";

/** Burn consumption is not proof that Circle paid out USDC. Never infer delivery from a balance change. */
export async function observeXreserveWithdrawal(activity: BridgeActivity): Promise<{
  patch: Partial<BridgeActivity>; warning?: string;
}> {
  if (activity.mode !== "send" || !activity.xreserveNoteId || activity.status === "complete" || activity.status === "failed") return { patch: {} };
  if (activity.xreserveBurnStatus === "confirmed") return { patch: {}, warning: "USDCx burned. Check the recipient's USDC balance; automatic payout verification is not available yet. Do not submit again." };
  const sdk = await import("@miden-sdk/miden-sdk");
  const rpc = new sdk.RpcClient(new sdk.Endpoint(process.env.NEXT_PUBLIC_MIDEN_RPC_URL ?? "https://rpc.testnet.miden.io"));
  const noteId = sdk.NoteId.fromHex(activity.xreserveNoteId);
  try {
    const result = await rpc.getNetworkNoteStatus(noteId);
    try {
      if (result.status === "Discarded") return { patch: { status: "failed", xreserveBurnStatus: "discarded" }, warning: result.lastError ?? "The network discarded the burn note. Keep its ID and contact support before retrying." };
      if (result.status === "NullifierCommitted") return {
        patch: { status: "message_observed", xreserveBurnStatus: "confirmed" },
        warning: "USDCx burned. Circle payout has not been verified. Do not submit again.",
      };
      return { patch: { xreserveBurnStatus: result.status === "NullifierInflight" ? "consuming" : activity.xreserveBurnStatus ?? "pending" } };
    } finally { result.free(); }
  } finally { noteId.free(); rpc.free(); }
}
