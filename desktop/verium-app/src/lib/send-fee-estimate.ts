/** Typical P2PKH send size used for fee preview (matches Qt ~195 byte txs). */
export const ESTIMATED_TX_SIZE_KB = 0.195;

/** Minimum fee often applied to small transactions in the legacy wallet UI. */
export const MIN_TX_FEE_VRM = 0.001;

export function estimateSendFee(
  feeRatePerKb: number,
  transactionCount = 1,
): { sizeKb: number; feePerTx: number; totalFee: number } {
  const feePerTx = Math.max(
    MIN_TX_FEE_VRM,
    feeRatePerKb * ESTIMATED_TX_SIZE_KB,
  );
  return {
    sizeKb: ESTIMATED_TX_SIZE_KB,
    feePerTx,
    totalFee: feePerTx * Math.max(1, transactionCount),
  };
}
