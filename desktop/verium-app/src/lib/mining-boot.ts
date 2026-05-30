/** How long to show "Starting…" after minerstart before treating 0 H/m as stalled. */
export const MINER_BOOT_GRACE_SECONDS = 120;

export function isMinerBooting(
  active: boolean,
  hashrate: number,
  startedAt: number | undefined,
  startPending = false,
  stopPending = false,
): boolean {
  if (stopPending) return false;
  if (startPending) return true;
  if (!active || hashrate > 0) return false;
  if (!startedAt) return true;
  return Date.now() / 1000 - startedAt < MINER_BOOT_GRACE_SECONDS;
}

export function miningInfoRefetchMs(
  active: boolean,
  hashrate: number,
  startedAt: number | undefined,
  idleMs = 5_000,
  activeMs?: number,
): number {
  const fastMs = activeMs ?? idleMs;
  if (isMinerBooting(active, hashrate, startedAt)) {
    return Math.min(fastMs, 1_000);
  }
  if (active || hashrate > 0) return fastMs;
  return idleMs;
}
