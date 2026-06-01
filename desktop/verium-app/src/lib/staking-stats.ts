/** Matches legacy Vericoin Qt overview: `(netStakeWeight/2)/30_000_000 * 100`. */
import type { ExplorerStats } from "@/lib/explorer-api";
import type { TransactionItem } from "@/lib/rpc/client";

export const VRC_SUPPLY_CAP = 30_000_000;

/** Mainnet `nStakeMinAge` — coins must be older than this before PoST kernels. */
export const VRC_STAKE_MIN_AGE_SECONDS = 8 * 60 * 60;

/** Mainnet coin selection uses `nMaturity + 10` confirmations (500 + 10). */
export const VRC_STAKE_MATURITY_CONFIRMATIONS = 510;

const STAKE_TARGET_SPACING_SECONDS = 60;

/** Relative time-weight at which we describe weight as "near maximum" for UX. */
const WEIGHT_RAMP_REFERENCE_SECONDS = 30 * 86400 - VRC_STAKE_MIN_AGE_SECONDS;

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

/**
 * `getwalletinfo.staketime` while staking is active: integer hours from
 * `GetTimeToStake()` (Vericoin Qt shows "Next reward estimated in N hour(s)").
 */
export function rpcStakeTimeHoursToSeconds(hours: number): number {
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  return Math.round(hours * 3600);
}

/** Human-readable duration for staking estimates (seconds in). */
export function formatEstimatedDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "—";
  const secs = Math.round(totalSeconds);
  if (secs < 90) return `~${secs}s`;
  if (secs < 3600) return `~${Math.round(secs / 60)} min`;
  if (secs < 86400) {
    const h = Math.floor(secs / 3600);
    const m = Math.round((secs % 3600) / 60);
    return m > 0 ? `~${h} h ${m} m` : `~${h} h`;
  }
  const days = Math.floor(secs / 86400);
  const h = Math.round((secs % 86400) / 3600);
  if (days < 14) return h > 0 ? `~${days} d ${h} h` : `~${days} d`;
  const weeks = Math.floor(days / 7);
  const remDays = days % 7;
  if (days < 60) return remDays > 0 ? `~${weeks} w ${remDays} d` : `~${weeks} w`;
  const months = Math.round(days / 30);
  return `~${months} mo`;
}

export interface ExpectedStakeRewardEstimate {
  seconds: number;
  label: string;
  disclaimer: string;
  source: "node" | "ratio";
}

/** Expected time to mint a stake reward (mean-style; actual time varies). */
export function estimateExpectedStakeReward(options: {
  stakeTimeHours?: number;
  walletStakeWeight?: number;
  netStakeWeight?: number;
  stakingActive?: boolean;
}): ExpectedStakeRewardEstimate | null {
  const { stakeTimeHours, walletStakeWeight, netStakeWeight, stakingActive } =
    options;

  if (stakingActive && stakeTimeHours != null && stakeTimeHours > 0) {
    const seconds = rpcStakeTimeHoursToSeconds(stakeTimeHours);
    return {
      seconds,
      label: formatEstimatedDuration(seconds),
      disclaimer:
        "Statistical estimate from your node (same model as Vericoin Qt). Actual time varies widely.",
      source: "node",
    };
  }

  if (
    walletStakeWeight != null &&
    walletStakeWeight > 0 &&
    netStakeWeight != null &&
    netStakeWeight > 0
  ) {
    const seconds = Math.round(
      (netStakeWeight / walletStakeWeight) * STAKE_TARGET_SPACING_SECONDS,
    );
    return {
      seconds,
      label: formatEstimatedDuration(seconds),
      disclaimer:
        "Rough ratio from network stake weight. Start staking for your node’s kernel-based estimate.",
      source: "ratio",
    };
  }

  return null;
}

export interface YoungestStakeReceive {
  amount: number;
  confirmations: number;
  coinTime: number;
}

/** Newest incoming funds — PoST weight grows from this timestamp. */
export function findYoungestStakeReceive(
  txs: TransactionItem[],
): YoungestStakeReceive | null {
  let best: YoungestStakeReceive | null = null;
  for (const tx of txs) {
    if (tx.category !== "receive" || tx.amount <= 0) continue;
    const coinTime = tx.blocktime ?? tx.timereceived ?? tx.time;
    if (!best || coinTime > best.coinTime) {
      best = {
        amount: tx.amount,
        confirmations: tx.confirmations,
        coinTime,
      };
    }
  }
  return best;
}

export interface CoinAgeMaturityStatus {
  eligible: boolean;
  secondsUntilMinAge: number;
  timeWeightSeconds: number;
  coinAgeSeconds: number;
}

export function computeCoinAgeMaturity(
  coinTimeUnix: number,
  nowSeconds = Math.floor(Date.now() / 1000),
): CoinAgeMaturityStatus {
  const coinAgeSeconds = Math.max(0, nowSeconds - coinTimeUnix);
  const secondsUntilMinAge = Math.max(
    0,
    VRC_STAKE_MIN_AGE_SECONDS - coinAgeSeconds,
  );
  const eligible = secondsUntilMinAge === 0;
  const timeWeightSeconds = eligible
    ? Math.max(0, coinAgeSeconds - VRC_STAKE_MIN_AGE_SECONDS)
    : 0;
  return { eligible, secondsUntilMinAge, timeWeightSeconds, coinAgeSeconds };
}

/** 0–1 factor for how much PoST time-weight has accumulated vs ~30d reference. */
export function stakeWeightRampFactor(timeWeightSeconds: number): number {
  if (WEIGHT_RAMP_REFERENCE_SECONDS <= 0) return 1;
  return Math.min(1, Math.max(0, timeWeightSeconds / WEIGHT_RAMP_REFERENCE_SECONDS));
}

export interface PostReadinessSummary {
  minAgeLabel: string;
  minAgeDetail: string;
  maturityLabel: string;
  maturityDetail: string;
  weightRampLabel: string;
  weightRampDetail: string;
}

export function buildPostReadinessSummary(options: {
  receive: YoungestStakeReceive | null;
  walletStakeWeight?: number;
  nowSeconds?: number;
}): PostReadinessSummary {
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const receive = options.receive;

  if (!receive) {
    return {
      minAgeLabel: "No funded UTXOs",
      minAgeDetail: "Receive VRC to this wallet to begin PoST staking.",
      maturityLabel: "—",
      maturityDetail: "",
      weightRampLabel: "Stake weight",
      weightRampDetail:
        options.walletStakeWeight != null && options.walletStakeWeight > 0
          ? `Node reports weight ${options.walletStakeWeight} (coin-age units, not VRC balance).`
          : "Shown after coins mature and staking runs.",
    };
  }

  const age = computeCoinAgeMaturity(receive.coinTime, now);
  const minAgeLabel = age.eligible
    ? "Ready"
    : formatEstimatedDuration(age.secondsUntilMinAge).replace(/^~/, "In ~");
  const minAgeDetail = age.eligible
    ? `Coins are older than ${VRC_STAKE_MIN_AGE_SECONDS / 3600}h (PoST minimum).`
    : `PoST requires ${VRC_STAKE_MIN_AGE_SECONDS / 3600}h coin age before kernels.`;

  const matureEnough =
    receive.confirmations >= VRC_STAKE_MATURITY_CONFIRMATIONS;
  const maturityLabel = matureEnough
    ? "Confirmations OK"
    : `${receive.confirmations} / ${VRC_STAKE_MATURITY_CONFIRMATIONS} conf`;
  const maturityDetail = matureEnough
    ? "Meets wallet coin-selection depth for staking."
    : "Wallet may not select this UTXO for staking until depth is reached.";

  const ramp = stakeWeightRampFactor(age.timeWeightSeconds);
  const rampPct = Math.round(ramp * 100);
  const weightRampLabel =
    options.walletStakeWeight != null && options.walletStakeWeight > 0
      ? `Weight ${options.walletStakeWeight}`
      : rampPct > 0
        ? `Weight ramp ~${rampPct}%`
        : "Weight ramp starting";
  const weightRampDetail = age.eligible
    ? ramp >= 1
      ? "PoST weight is near its practical plateau for this UTXO; rewards still depend on network luck."
      : `Weight rises with coin age after the ${VRC_STAKE_MIN_AGE_SECONDS / 3600}h minimum (reference ~30 days to full ramp).`
    : "Weight begins accumulating after the minimum coin-age gate.";

  return {
    minAgeLabel,
    minAgeDetail,
    maturityLabel,
    maturityDetail,
    weightRampLabel,
    weightRampDetail,
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
