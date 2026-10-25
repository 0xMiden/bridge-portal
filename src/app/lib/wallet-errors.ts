import { isUserRejection } from "../../wallets/errors";

export function errorMessage(error: unknown) {
  if (isUserRejection(error)) return "You cancelled the request in your wallet.";
  const fields = typeof error === "object" && error
    ? error as { message?: unknown; shortMessage?: unknown; details?: unknown }
    : {};
  const message = typeof error === "string" ? error
    : typeof fields.message === "string" ? fields.message : "";
  const details = typeof fields.details === "string" ? fields.details : "";
  // viem adds calldata and request metadata to .message. Our RPC's actionable
  // outage explanation survives in .details (or in a serialized error).
  const outage = `${details}\n${message}`.match(
    /(?:Ethereum|Base(?: Sepolia)?|Arbitrum(?: Sepolia)?|Arc(?: Testnet)?|Sepolia) RPC is temporarily unavailable\. Please retry shortly\./,
  );
  if (outage) return outage[0];
  const summary = typeof fields.shortMessage === "string" && fields.shortMessage.trim()
    ? fields.shortMessage : message;
  const text = summary
    .split(/\n\s*\n|\b(?:URL|Request body|Raw Call Arguments|Contract Call|Docs|Details|Version):/)[0]
    .replace(/\s+/g, " ").trim();
  if (!text) return "Something went wrong. Try again.";
  return text.length > 280 ? `${text.slice(0, 279).trimEnd()}…` : text;
}
