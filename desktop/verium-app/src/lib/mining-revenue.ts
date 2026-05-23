import type { ExplorerStats } from "@/lib/explorer-api";
import type { MiningInfo } from "@/lib/rpc/client";

/** Convert networkhashps (H/s) from getmininginfo to kH/m (explorer convention). */
export function networkHashToKhm(networkHashPs: number): number {
  return (networkHashPs * 60) / 1000;
}

export type NetworkStatsSource = "explorer" | "local";

export interface NetworkStats {
  networkHash?: number;
  blockReward?: number;
  blocksPerHour?: number;
  blockTimeMin?: number;
  priceUsd?: number;
  priceBtc?: number;
  source: NetworkStatsSource;
}

export function buildNetworkStats(
  explorer: ExplorerStats | undefined | null,
  mining: MiningInfo | undefined | null,
): NetworkStats | null {
  const networkHash =
    explorer?.network_hash ?? mining?.networkhashps ?? undefined;
  const blockReward =
    explorer?.block_reward ?? mining?.blockreward ?? undefined;
  const blocksPerHour =
    explorer?.blocks_per_hour ?? mining?.blocksperhour ?? undefined;
  const blockTimeMin =
    explorer?.block_time_min ?? mining?.blocktime ?? undefined;

  if (
    networkHash === undefined ||
    blockReward === undefined ||
    blocksPerHour === undefined
  ) {
    return null;
  }

  return {
    networkHash,
    blockReward,
    blocksPerHour,
    blockTimeMin,
    priceUsd: explorer?.price_usd,
    priceBtc: explorer?.price_btc,
    source: explorer?.network_hash != null ? "explorer" : "local",
  };
}

/** Average gap between consecutive blocks (minutes), from explorer block timestamps. */
export function averageBlockTimeMinutes(
  blocks: Array<{ time: number }> | undefined | null,
): number | null {
  if (!blocks || blocks.length < 2) return null;

  const sorted = [...blocks].sort((a, b) => b.time - a.time);
  let totalGapSec = 0;
  let gaps = 0;

  for (let i = 0; i < sorted.length - 1; i++) {
    const gapSec = sorted[i]!.time - sorted[i + 1]!.time;
    if (gapSec > 0) {
      totalGapSec += gapSec;
      gaps++;
    }
  }

  if (gaps === 0) return null;
  return totalGapSec / gaps / 60;
}

export function networkSharePercent(
  localHashrateHm: number,
  networkHashPs: number | undefined,
): number | null {
  if (
    !Number.isFinite(localHashrateHm) ||
    localHashrateHm <= 0 ||
    networkHashPs === undefined ||
    !Number.isFinite(networkHashPs) ||
    networkHashPs <= 0
  ) {
    return null;
  }
  const networkHm = networkHashPs * 60;
  return (localHashrateHm / networkHm) * 100;
}

export function estimateHoursPerBlock(
  localHashrateHm: number,
  networkStats: NetworkStats | null,
): number | null {
  if (!networkStats?.networkHash || localHashrateHm <= 0) return null;
  if (networkStats.blockTimeMin && networkStats.blockTimeMin > 0) {
    return (networkStats.networkHash * networkStats.blockTimeMin) / localHashrateHm;
  }
  if (networkStats.blocksPerHour && networkStats.blocksPerHour > 0) {
    const share = localHashrateHm / (networkStats.networkHash * 60);
    const blocksPerDay = share * networkStats.blocksPerHour * 24;
    return blocksPerDay > 0 ? 24 / blocksPerDay : null;
  }
  return null;
}

export interface DailyMiningEstimate {
  blocksPerDay: number;
  vrmPerDay: number;
  usdPerDay?: number;
  btcPerDay?: number;
  hoursPerBlock?: number;
}

export function estimateDailyMining(params: {
  localHashrateHm: number;
  networkHashrateHs: number;
  blocksPerHour: number;
  blockReward: number;
  priceUsd?: number;
  priceBtc?: number;
}): DailyMiningEstimate | null {
  const {
    localHashrateHm,
    networkHashrateHs,
    blocksPerHour,
    blockReward,
    priceUsd,
    priceBtc,
  } = params;

  if (
    !Number.isFinite(localHashrateHm) ||
    localHashrateHm <= 0 ||
    !Number.isFinite(networkHashrateHs) ||
    networkHashrateHs <= 0 ||
    !Number.isFinite(blocksPerHour) ||
    blocksPerHour <= 0 ||
    !Number.isFinite(blockReward) ||
    blockReward <= 0
  ) {
    return null;
  }

  const networkHm = networkHashrateHs * 60;
  const share = localHashrateHm / networkHm;
  const blocksPerDay = share * blocksPerHour * 24;
  const vrmPerDay = blocksPerDay * blockReward;
  const hoursPerBlock = blocksPerDay > 0 ? 24 / blocksPerDay : undefined;

  return {
    blocksPerDay,
    vrmPerDay,
    usdPerDay:
      priceUsd !== undefined && Number.isFinite(priceUsd)
        ? vrmPerDay * priceUsd
        : undefined,
    btcPerDay:
      priceBtc !== undefined && Number.isFinite(priceBtc)
        ? vrmPerDay * priceBtc
        : undefined,
    hoursPerBlock,
  };
}

export function estimateDailyElectricityCostUsd(
  watts: number | undefined,
  costPerKwh: number | undefined,
): number | null {
  if (
    watts === undefined ||
    costPerKwh === undefined ||
    !Number.isFinite(watts) ||
    !Number.isFinite(costPerKwh) ||
    watts <= 0 ||
    costPerKwh <= 0
  ) {
    return null;
  }
  return (watts / 1000) * 24 * costPerKwh;
}

export function formatSessionDuration(startedAtSec: number): string {
  const elapsed = Math.max(0, Math.floor(Date.now() / 1000 - startedAtSec));
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${elapsed}s`;
}

export function suggestedThreadCount(): number {
  const cores =
    typeof navigator !== "undefined" ? navigator.hardwareConcurrency : 4;
  return Math.max(1, Math.min(64, (cores || 4) - 1));
}

export type RevenuePeriod = "day" | "week" | "month" | "year";

export const REVENUE_PERIODS: RevenuePeriod[] = [
  "day",
  "week",
  "month",
  "year",
];

const PERIOD_DAYS: Record<RevenuePeriod, number> = {
  day: 1,
  week: 7,
  month: 30,
  year: 365,
};

export function revenuePeriodLabel(period: RevenuePeriod): string {
  return period;
}

export function scaleDailyValue(
  dailyValue: number,
  period: RevenuePeriod,
): number {
  return dailyValue * PERIOD_DAYS[period];
}
