import type { Activity } from "./bridge-state";

// Dummy transfers for previewing the detail page without a live bridge run:
// the four settled receipts (/activity/demo-<provider>-<mode>) plus a failed and
// an in-flight state (/activity/demo-failed, /activity/demo-inflight) so every
// status surface is reviewable. Never persisted; ignored by real history.
const MIDEN_ACCOUNT = "mtst1aqk5t00kapdcnq2yyf77dz6xcyssweun_qr7qqq9wr6w";
const SEPOLIA_ADDR = "0x3650dB63221d7A67f9b99B0C3590D366701D0Dd9";
const HASH_A = "0x6da1f0c4b8e29d7a3f51c0b96e4d8127ac3e5f90b21748c6be9d0a2f34c656978";
const HASH_B = "0xab12cd34ef5678901234567890abcdef1234567890abcdef1234567890ab7f01";
const HASH_C = "0x9f3c7e21ab45d089c1234567890abcdef67890abcdef1234567890abcd5b8e44";
const HASH_D = "0x7c88b0aa1122334455667788990011223344556677889900aabbccddee9c1f30";

function make(over: Partial<Activity>): Activity {
  return {
    id: "demo",
    mode: "receive",
    provider: "epoch",
    summary: "",
    status: "complete",
    eta: "1-3 min",
    amount: "0",
    asset: "USDC",
    txHash: "0x0",
    updatedAt: 1747845606000, // fixed so the receipt date/time is stable
    ...over,
  };
}

export const DEMO_ACTIVITIES: Record<string, Activity> = {
  "demo-epoch-receive": make({
    id: "demo-epoch-receive",
    mode: "receive",
    provider: "epoch",
    asset: "USDC",
    amount: "10",
    eta: "1-3 min",
    receivedAmount: "9.98 USDC",
    destination: MIDEN_ACCOUNT,
    midenAccountHex: "0x1f2c9a5b7e0d34a8c6f10b92e4d78156",
    sourceTxHash: HASH_A,
    txHash: HASH_A,
    summary: "Receive 10 USDC on Miden",
  }),
  "demo-epoch-send": make({
    id: "demo-epoch-send",
    mode: "send",
    provider: "epoch",
    asset: "USDC",
    amount: "5",
    eta: "1-3 min",
    receivedAmount: "4.99 USDC",
    destination: SEPOLIA_ADDR,
    sourceTxHash: HASH_B,
    midenTxId: HASH_B,
    txHash: HASH_B,
    summary: "Send 5 USDC to Sepolia",
  }),
  "demo-agglayer-receive": make({
    id: "demo-agglayer-receive",
    mode: "receive",
    provider: "agglayer",
    asset: "ETH",
    amount: "0.01",
    eta: "10-20 min",
    receivedAmount: "0.01 ETH",
    destination: MIDEN_ACCOUNT,
    bridgeDestinationAddress: SEPOLIA_ADDR,
    midenAccountHex: "0x1f2c9a5b7e0d34a8c6f10b92e4d78156",
    sourceTxHash: HASH_C,
    txHash: HASH_C,
    summary: "Receive 0.01 ETH on Miden",
  }),
  "demo-agglayer-send": make({
    id: "demo-agglayer-send",
    mode: "send",
    provider: "agglayer",
    asset: "ETH",
    amount: "0.005",
    eta: "10-20 min",
    receivedAmount: "0.005 ETH",
    destination: SEPOLIA_ADDR,
    sourceTxHash: HASH_D,
    midenTxId: HASH_D,
    txHash: HASH_D,
    summary: "Send 0.005 ETH to Sepolia",
  }),
  "demo-failed": make({
    id: "demo-failed",
    mode: "receive",
    provider: "epoch",
    status: "failed",
    asset: "USDC",
    amount: "10",
    eta: "Stalled at source finality",
    destination: MIDEN_ACCOUNT,
    sourceTxHash: HASH_A,
    txHash: HASH_A,
    summary: "Receive 10 USDC on Miden",
  }),
  "demo-inflight": make({
    id: "demo-inflight",
    mode: "receive",
    provider: "epoch",
    status: "message_observed",
    asset: "USDC",
    amount: "10",
    eta: "1-3 min",
    destination: MIDEN_ACCOUNT,
    sourceTxHash: HASH_A,
    txHash: HASH_A,
    summary: "Receive 10 USDC on Miden",
  }),
};
