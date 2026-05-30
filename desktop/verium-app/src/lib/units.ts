import type { CoinId } from "@/lib/coin/profile";
import { getCoinProfile } from "@/lib/coin/profile";
import { formatNumber } from "@/lib/utils";

const SATS_PER_COIN = 100_000_000;

export function formatCoinAmount(amount: number, coin: CoinId, digits = 8): string {
  const symbol = getCoinProfile(coin).symbol;
  if (!Number.isFinite(amount)) return `0 ${symbol}`;
  const abs = Math.abs(amount);
  const frac = abs >= 1 ? Math.min(4, digits) : Math.min(8, digits);
  if (abs === 0) return `${(0).toFixed(frac)} ${symbol}`;
  if (abs >= 1) return `${amount.toFixed(frac)} ${symbol}`;
  return `${amount.toFixed(frac)} ${symbol}`;
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

/** Alternative subdivisions shown in the send confirmation dialog. */
export function formatCoinAlternates(total: number, coin: CoinId): string {
  const symbol = getCoinProfile(coin).symbol;
  const milli = total * 1_000;
  const micro = total * 1_000_000;
  const sats = Math.round(total * SATS_PER_COIN);
  return `(=${formatNumber(milli, 5)} m${symbol} or ${formatNumber(micro, 2)} µ${symbol} or ${formatNumber(sats, 0)} ${symbol}i)`;
}

export function formatRecipientLine(
  coin: CoinId,
  options: {
    amount: number;
    address: string;
    label?: string;
  },
): string {
  const amount = formatCoinAmount(options.amount, coin, 8);
  const label = options.label?.trim();
  if (label) {
    return `${amount} to '${label}' (${options.address})`;
  }
  return `${amount} to ${options.address}`;
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
