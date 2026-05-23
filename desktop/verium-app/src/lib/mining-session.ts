/**
 * Tracks when the user explicitly stopped mining this session so auto-mine
 * does not immediately restart the CPU miner.
 */
let stoppedByUser = false;

export function markMiningStoppedByUser(): void {
  stoppedByUser = true;
}

export function clearMiningStoppedByUser(): void {
  stoppedByUser = false;
}

export function wasMiningStoppedByUser(): boolean {
  return stoppedByUser;
}
