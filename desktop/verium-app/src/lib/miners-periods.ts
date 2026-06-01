/** Miners leaderboard periods (matches explorer `/v1/:chain/miners`). */
export const MINERS_PERIODS = [
  { id: "week", label: "This week" },
  { id: "month", label: "This month" },
  { id: "year", label: "Past year" },
  { id: "all", label: "All time" },
] as const;

export type MinersPeriodId = (typeof MINERS_PERIODS)[number]["id"];

const MINERS_PERIOD_IDS = new Set<string>(MINERS_PERIODS.map((p) => p.id));

const LEGACY_MINERS_PERIOD_ALIASES: Record<string, MinersPeriodId> = {
  "7d": "week",
  "30d": "month",
};

export function normalizeMinersPeriod(
  value: string | undefined,
  fallback: MinersPeriodId = "month",
): MinersPeriodId {
  const raw = (value || fallback).trim().toLowerCase();
  const period = LEGACY_MINERS_PERIOD_ALIASES[raw] ?? raw;
  return MINERS_PERIOD_IDS.has(period)
    ? (period as MinersPeriodId)
    : fallback;
}

export function minersPeriodLabel(period: string | undefined): string {
  const normalized = normalizeMinersPeriod(period, "month");
  const match = MINERS_PERIODS.find((p) => p.id === normalized);
  return match?.label ?? "Selected period";
}
