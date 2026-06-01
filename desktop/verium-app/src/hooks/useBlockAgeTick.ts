import { useEffect, useState } from "react";

import { BLOCK_AGE_TICK_MS } from "@/lib/block-tip";

function msUntilNextSecond(): number {
  return BLOCK_AGE_TICK_MS - (Date.now() % BLOCK_AGE_TICK_MS);
}

/**
 * Wall-clock-aligned tick for `formatBlockAge` so "13s" → "14s" on each second
 * boundary instead of drifting on a fixed interval from mount.
 */
export function useBlockAgeTick(enabled = true): number {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;

    let timeoutId: number;

    const schedule = () => {
      setTick((n) => n + 1);
      timeoutId = window.setTimeout(schedule, msUntilNextSecond());
    };

    timeoutId = window.setTimeout(schedule, msUntilNextSecond());

    return () => window.clearTimeout(timeoutId);
  }, [enabled]);

  return tick;
}
