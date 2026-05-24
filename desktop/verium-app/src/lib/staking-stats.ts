/** Matches legacy Vericoin Qt overview: `(netStakeWeight/2)/30_000_000 * 100`. */
import type { ExplorerStats } from "@/lib/explorer-api";

export const VRC_SUPPLY_CAP = 30_000_000;

export interface VericoinMiningInfo {
  blocks: number;
  blockreward: number;
  blocksperhour: number;
  chain: string;
  networkhashps: number;
  pooledtx: number;
  warnings: string;
  stakeinterest?: number;
  stakeinflation?: number;
  netstakeweight?: number;
  stakeweight?: { combined?: number };
  difficulty?: {
    "proof-of-stake"?: number;
    "proof-of-work"?: number;
    "search-interval"?: number;
  };
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export function parseVericoinMiningInfo(raw: unknown): VericoinMiningInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const blocks = asNumber(o.blocks);
  if (blocks === undefined) return null;

  const difficultyRaw = o.difficulty;
  let difficulty: VericoinMiningInfo["difficulty"];
  if (difficultyRaw && typeof difficultyRaw === "object") {
    const d = difficultyRaw as Record<string, unknown>;
    difficulty = {
      "proof-of-stake": asNumber(d["proof-of-stake"]),
      "proof-of-work": asNumber(d["proof-of-work"]),
      "search-interval": asNumber(d["search-interval"]),
    };
  }

  const stakeWeightRaw = o.stakeweight;
  let stakeweight: VericoinMiningInfo["stakeweight"];
  if (stakeWeightRaw && typeof stakeWeightRaw === "object") {
    stakeweight = {
      combined: asNumber((stakeWeightRaw as Record<string, unknown>).combined),
    };
  }

  return {
    blocks,
    blockreward: asNumber(o.blockreward) ?? 0,
    blocksperhour: asNumber(o.blocksperhour) ?? 0,
    chain: String(o.chain ?? "vericoin"),
    networkhashps: asNumber(o.networkhashps) ?? 0,
    pooledtx: asNumber(o.pooledtx) ?? 0,
    warnings: String(o.warnings ?? ""),
    stakeinterest: asNumber(o.stakeinterest),
    stakeinflation: asNumber(o.stakeinflation),
    netstakeweight: asNumber(o.netstakeweight),
    stakeweight,
    difficulty,
  };
}

/** Percent of circulating supply actively staking on the network. */
export function networkCoinsStakingPercent(
  netStakeWeight: number | undefined,
): number | null {
  if (netStakeWeight == null || netStakeWeight <= 0) return null;
  return ((netStakeWeight / 2) / VRC_SUPPLY_CAP) * 100;
}

/** Your stake weight as a share of network stake weight. */
export function walletStakeSharePercent(
  walletStakeWeight: number | undefined,
  netStakeWeight: number | undefined,
): number | null {
  if (
    walletStakeWeight == null ||
    walletStakeWeight <= 0 ||
    netStakeWeight == null ||
    netStakeWeight <= 0
  ) {
    return null;
  }
  return (walletStakeWeight / netStakeWeight) * 100;
}

export function formatSessionDuration(startedAt: number): string {
  const secs = Math.max(0, Math.floor(Date.now() / 1000 - startedAt));
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

export type StakingNetworkSource = "local" | "explorer";

export interface StakingNetworkKpis {
  interestRate?: number;
  inflationRate?: number;
  netStakeWeight?: number;
  posDifficulty?: number;
  powDifficulty?: number;
  blocksPerHour?: number;
  blockReward?: number;
  supply?: number;
  source: StakingNetworkSource;
}

export function mergeStakingNetworkKpis(
  local: VericoinMiningInfo | null | undefined,
  explorer: ExplorerStats | null | undefined,
): StakingNetworkKpis {
  const interestRate = local?.stakeinterest ?? explorer?.stake_interest;
  const inflationRate = local?.stakeinflation ?? explorer?.stake_inflation;
  const netStakeWeight = local?.netstakeweight ?? explorer?.net_stake_weight;
  const posDifficulty =
    local?.difficulty?.["proof-of-stake"] ?? explorer?.pos_difficulty;
  const powDifficulty =
    local?.difficulty?.["proof-of-work"] ?? explorer?.pow_difficulty;
  const blocksPerHour = local?.blocksperhour ?? explorer?.blocks_per_hour;
  const blockReward = local?.blockreward ?? explorer?.block_reward;
  const supply = explorer?.supply;

  const source: StakingNetworkSource =
    local?.stakeinterest != null || local?.netstakeweight != null
      ? "local"
      : explorer?.stake_interest != null || explorer?.net_stake_weight != null
        ? "explorer"
        : "local";

  return {
    interestRate,
    inflationRate,
    netStakeWeight,
    posDifficulty,
    powDifficulty,
    blocksPerHour,
    blockReward,
    supply,
    source,
  };
}
