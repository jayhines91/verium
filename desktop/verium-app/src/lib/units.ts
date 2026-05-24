import type { CoinId } from "@/lib/coin/profile";
import { getCoinProfile } from "@/lib/coin/profile";

const SATS_PER_COIN = 100_000_000;

export function formatCoinAmount(amount: number, coin: CoinId, digits = 8): string {
  const symbol = getCoinProfile(coin).symbol;
  if (!Number.isFinite(amount)) return `0 ${symbol}`;
  const abs = Math.abs(amount);
  if (abs >= 1) return `${amount.toFixed(Math.min(4, digits))} ${symbol}`;
  if (abs >= 0.0001) return `${amount.toFixed(8)} ${symbol}`;
  return `${amount.toExponential(2)} ${symbol}`;
}

export function formatCoinAmountCompact(amount: number, coin: CoinId): string {
  const symbol = getCoinProfile(coin).symbol;
  if (!Number.isFinite(amount)) return `0 ${symbol}`;
  if (Math.abs(amount) >= 1000) {
    return `${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${symbol}`;
  }
  return `${amount.toFixed(4)} ${symbol}`;
}

export function coinSymbol(coin: CoinId): string {
  return getCoinProfile(coin).symbol;
}

export function coinMaturityConfirmations(coin: CoinId): number {
  return getCoinProfile(coin).confirmationsMatured;
}

export { SATS_PER_COIN };

/** @deprecated use formatCoinAmount(amount, "verium") */
export function formatVrm(amount: number, digits = 8): string {
  return formatCoinAmount(amount, "verium", digits);
}

/** @deprecated use formatCoinAmountCompact(amount, "verium") */
export function formatVrmCompact(amount: number): string {
  return formatCoinAmountCompact(amount, "verium");
}
