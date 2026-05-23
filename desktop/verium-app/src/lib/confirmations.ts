/**
 * Coinbase maturity from src/consensus/consensus.h (100). Generated coins
 * become spendable after COINBASE_MATURITY + 1 confirmations — see
 * CWalletTx::GetBlocksToMaturity in src/wallet/wallet.cpp and Qt transactiondesc.
 */
const COINBASE_MATURITY = 100;

/** Confirmations required before mined coins can be spent. */
export const COINBASE_SPEND_MATURITY = COINBASE_MATURITY + 1;

export function requiredConfirmations(category: string): number {
  if (category === "immature" || category === "generate") {
    return COINBASE_SPEND_MATURITY;
  }
  return 1;
}

export function blocksUntilSpendable(
  confirmations: number,
  category: string,
): number {
  const required = requiredConfirmations(category);
  if (category !== "immature" && category !== "generate") return 0;
  return Math.max(0, required - confirmations);
}

export function confirmationProgress(
  confirmations: number,
  required: number,
): number {
  if (required <= 0) return 0;
  return Math.min(1, Math.max(0, confirmations / required));
}

export function isFullyConfirmed(
  confirmations: number,
  required: number,
): boolean {
  return confirmations >= required;
}

export function confirmationStatusLabel(
  confirmations: number,
  category: string,
): string {
  const required = requiredConfirmations(category);
  const remaining = blocksUntilSpendable(confirmations, category);

  if (category === "immature" || category === "generate") {
    if (remaining === 0) {
      return `${confirmations} confirmations — mature`;
    }
    return `${confirmations} of ${required} confirmations — matures in ${remaining} more block${remaining === 1 ? "" : "s"}`;
  }

  if (confirmations >= required) {
    return `${confirmations} confirmations`;
  }
  return `${confirmations} of ${required} confirmations`;
}
