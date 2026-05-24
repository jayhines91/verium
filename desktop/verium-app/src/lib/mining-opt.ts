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

export async function fetchCpuTopology(): Promise<CpuTopology> {
  return invoke<CpuTopology>("cpu_topology");
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

export function maxMiningThreads(topology: CpuTopology | undefined): number {
  if (topology?.logicalCpus && topology.logicalCpus > 0) {
    return topology.logicalCpus;
  }
  if (typeof navigator !== "undefined" && navigator.hardwareConcurrency) {
    return Math.max(MINING_THREADS_MIN, navigator.hardwareConcurrency);
  }
  return MINING_THREADS_FALLBACK_MAX;
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

/** Resolve thread count from user prefs: auto-adjust or manual override. */
export function resolveMiningThreads(
  topology: CpuTopology | undefined,
  autoAdjust: boolean,
  manualThreads: number,
): number {
  const max = maxMiningThreads(topology);
  if (autoAdjust) return optimizedMiningThreads(topology);
  return clampMiningThreads(manualThreads, max);
}
