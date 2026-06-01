/** Upper bounds for solo economics inputs (estimates only). */
export const MINING_VRM_PRICE_USD_MAX = 1_000_000;
export const MINING_POWER_WATTS_MAX = 50_000;
export const MINING_COST_PER_KWH_MAX = 5;

export function parseOptionalBoundedNumber(
  raw: string,
  max: number,
): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.min(max, n);
}

export function clampMiningVrmPriceUsd(
  value: number | undefined,
): number | undefined {
  if (value == null || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.min(MINING_VRM_PRICE_USD_MAX, value);
}

export function clampMiningPowerWatts(
  value: number | undefined,
): number | undefined {
  if (value == null || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.min(MINING_POWER_WATTS_MAX, value);
}

export function clampMiningCostPerKwh(
  value: number | undefined,
): number | undefined {
  if (value == null || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.min(MINING_COST_PER_KWH_MAX, value);
}

/** Format USD for display; avoids scientific noise from bad stored prefs. */
export function formatMiningUsd(value: number, fractionDigits = 4): string {
  if (!Number.isFinite(value)) return "—";
  const capped = Math.min(value, 1e12);
  if (capped >= 1e9) return `$${capped.toExponential(2)}`;
  if (capped >= 1_000_000) {
    return `$${capped.toLocaleString(undefined, {
      maximumFractionDigits: 2,
    })}`;
  }
  return `$${capped.toLocaleString(undefined, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}`;
}
