export interface CrossChainIntentParams {
  midenAccountId: string;
  midenFaucetId: string;
  /** Miden input amount in base units. */
  midenAmount: string;
  evmRecipient: string;
  destinationChainId: number;
  outputTokenAddress: string;
  minTokenOut: string;
}

export interface EVMToMidenIntentParams {
  /** Miden virtual chain id. */
  destinationChainId: number;
  evmSourceAddress: string;
  evmTokenAddress: string;
  /** Human-readable EVM input amount and source-token precision. */
  evmAmount: string;
  evmTokenDecimals: number;
  midenRecipientId: string;
  midenFaucetId: string;
  /** Slippage floor in Miden output base units. */
  minTokenOut: string;
}

export interface IntentResult {
  taskTypeString: string;
  intentData: Record<string, unknown>;
  solveResult?: {
    /** SDK 1.0.39 returns the allocation nonce at this level. */
    nonce?: string;
    /**
     * Client-side EVM deposit into The Compact contract (depositERC20AndRegister
     * / depositNativeAndRegister). Populated by the SDK after the user's wallet
     * signs the deposit tx; only present for EVM-collateral flows.
     */
    depositResult?: {
      success?: boolean;
      transactionHash?: string;
    };
  };
  error?: string;
}
