import { invoke } from "@tauri-apps/api/core";

export interface CpuTopology {
  logicalCpus: number;
  physicalCpus: number;
  performanceCores: number;
  efficiencyCores: number;
  avx2: boolean;
  avx512: boolean;
  shaNi: boolean;
  armSha2: boolean;
  suggestedMiningThreads: number;
}

export interface ScryptBenchResult {
  tier: string;
  throughput: number;
  benchOutput: string;
  elapsedMs: number;
}

export interface CpuUtilizationSnapshot {
  systemUtilizationPercent: number;
  systemIdlePercent: number;
  daemonUtilizationPercent: number | null;
  otherUtilizationPercent: number;
}

/** Poll interval for adaptive mining thread changes while mining. */
export const ADAPTIVE_MINING_POLL_MS = 30_000;

/** Consecutive samples required before changing thread count (reduces thrashing). */
export const ADAPTIVE_CONSECUTIVE_SAMPLES = 2;

/** Non-miner CPU above this → reduce mining threads. */
export const ADAPTIVE_OTHER_UTIL_HIGH = 55;

/** Non-miner CPU below this → increase mining threads toward device ceiling. */
export const ADAPTIVE_OTHER_UTIL_LOW = 20;

/** System idle below this when daemon CPU is unknown → reduce threads. */
export const ADAPTIVE_IDLE_LOW_PERCENT = 22;

/** System idle above this when daemon CPU is unknown → increase threads. */
export const ADAPTIVE_IDLE_HIGH_PERCENT = 45;

export interface AdaptiveThreadState {
  consecutiveHighLoad: number;
  consecutiveLowLoad: number;
}

export const INITIAL_ADAPTIVE_THREAD_STATE: AdaptiveThreadState = {
  consecutiveHighLoad: 0,
  consecutiveLowLoad: 0,
};

export async function fetchCpuTopology(): Promise<CpuTopology> {
  return invoke<CpuTopology>("cpu_topology");
}

export async function fetchCpuUtilizationSnapshot(): Promise<CpuUtilizationSnapshot> {
  return invoke<CpuUtilizationSnapshot>("cpu_utilization_snapshot");
}

export async function runScryptBench(): Promise<ScryptBenchResult> {
  return invoke<ScryptBenchResult>("bench_scrypt");
}

export async function isOnAcPower(): Promise<boolean> {
  return invoke<boolean>("battery_on_ac_power");
}

export const MINING_THREADS_MIN = 1;
/** Fallback when CPU topology is not available yet. */
export const MINING_THREADS_FALLBACK_MAX = 64;

/** Logical CPUs reported by the OS / topology probe (for display). */
export function detectedLogicalCpus(topology: CpuTopology | undefined): number {
  if (topology?.logicalCpus && topology.logicalCpus > 0) {
    return topology.logicalCpus;
  }
  if (typeof navigator !== "undefined" && navigator.hardwareConcurrency) {
    return Math.max(MINING_THREADS_MIN, navigator.hardwareConcurrency);
  }
  return MINING_THREADS_FALLBACK_MAX;
}

/**
 * Maximum mining threads — always one less than detected logical CPUs so the
 * system keeps a core for the OS and wallet UI.
 */
export function maxMiningThreads(topology: CpuTopology | undefined): number {
  const detected = detectedLogicalCpus(topology);
  return Math.max(MINING_THREADS_MIN, detected - 1);
}

/** User chose to mine on every logical CPU (not allowed). */
export function triedToMineOnAllLogicalCpus(
  threads: number,
  topology: CpuTopology | undefined,
  detectedOverride?: number,
): boolean {
  const detected = detectedOverride ?? detectedLogicalCpus(topology);
  return detected > 1 && threads >= detected;
}

export function clampMiningThreads(
  n: number,
  max = MINING_THREADS_FALLBACK_MAX,
): number {
  return Math.max(
    MINING_THREADS_MIN,
    Math.min(max, n || MINING_THREADS_MIN),
  );
}

/** Thread count tuned for this device from CPU topology (P-core aware). */
export function optimizedMiningThreads(topology: CpuTopology | undefined): number {
  if (!topology) return 2;
  const max = maxMiningThreads(topology);
  const n =
    topology.suggestedMiningThreads > 0
      ? topology.suggestedMiningThreads
      : topology.performanceCores;
  return clampMiningThreads(n, max);
}

/** Max threads for auto-adjust (device-tuned ceiling from topology). */
export function adaptiveMiningCeiling(topology: CpuTopology | undefined): number {
  return optimizedMiningThreads(topology);
}

export type AdaptiveLoadSignal = "high" | "low" | "neutral";

/** Classify CPU load for adaptive thread scaling. */
export function adaptiveLoadSignal(
  snapshot: CpuUtilizationSnapshot,
): AdaptiveLoadSignal {
  if (snapshot.daemonUtilizationPercent != null) {
    if (snapshot.otherUtilizationPercent >= ADAPTIVE_OTHER_UTIL_HIGH) {
      return "high";
    }
    if (snapshot.otherUtilizationPercent <= ADAPTIVE_OTHER_UTIL_LOW) {
      return "low";
    }
    return "neutral";
  }
  if (snapshot.systemIdlePercent <= ADAPTIVE_IDLE_LOW_PERCENT) {
    return "high";
  }
  if (snapshot.systemIdlePercent >= ADAPTIVE_IDLE_HIGH_PERCENT) {
    return "low";
  }
  return "neutral";
}

/**
 * Next mining thread count from CPU load with hysteresis.
 * `ceiling` is the device-tuned max (topology); `floor` is always 1.
 */
export function nextAdaptiveMiningThreads(
  currentThreads: number,
  ceiling: number,
  floor: number,
  snapshot: CpuUtilizationSnapshot,
  state: AdaptiveThreadState,
): { threads: number; state: AdaptiveThreadState } {
  const cappedCeiling = Math.max(floor, ceiling);
  let threads = clampMiningThreads(currentThreads, cappedCeiling);
  let { consecutiveHighLoad, consecutiveLowLoad } = state;
  const signal = adaptiveLoadSignal(snapshot);

  if (signal === "high") {
    consecutiveHighLoad += 1;
    consecutiveLowLoad = 0;
  } else if (signal === "low") {
    consecutiveLowLoad += 1;
    consecutiveHighLoad = 0;
  } else {
    consecutiveHighLoad = 0;
    consecutiveLowLoad = 0;
  }

  if (
    consecutiveHighLoad >= ADAPTIVE_CONSECUTIVE_SAMPLES &&
    threads > floor
  ) {
    threads = Math.max(floor, threads - 1);
    consecutiveHighLoad = 0;
    consecutiveLowLoad = 0;
  } else if (
    consecutiveLowLoad >= ADAPTIVE_CONSECUTIVE_SAMPLES &&
    threads < cappedCeiling
  ) {
    threads = Math.min(cappedCeiling, threads + 1);
    consecutiveHighLoad = 0;
    consecutiveLowLoad = 0;
  }

  return {
    threads,
    state: { consecutiveHighLoad, consecutiveLowLoad },
  };
}

/** Resolve thread count from user prefs: auto-adjust or manual override. */
export function resolveMiningThreads(
  topology: CpuTopology | undefined,
  autoAdjust: boolean,
  manualThreads: number,
): number {
  const max = maxMiningThreads(topology);
  if (autoAdjust) return adaptiveMiningCeiling(topology);
  return clampMiningThreads(manualThreads, max);
}
