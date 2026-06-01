import { useEffect, useRef, useState } from "react";
import type { CoinId } from "@/lib/coin/profile";

/**
 * True briefly after `coin` changes until `isReady` is true for the latest switch.
 * Ignores stale ready signals when the user switches chains again before data loads.
 */
export function useChainSwitchTransition(
  coin: CoinId,
  options: { enabled?: boolean; isReady: boolean },
): boolean {
  const enabled = options.enabled ?? true;
  const prevCoinRef = useRef(coin);
  const generationRef = useRef(0);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    if (prevCoinRef.current === coin) return;
    prevCoinRef.current = coin;
    if (!enabled) return;
    generationRef.current += 1;
    setSwitching(true);
  }, [coin, enabled]);

  useEffect(() => {
    if (!switching || !enabled || !options.isReady) return;
    const gen = generationRef.current;
    const id = window.requestAnimationFrame(() => {
      if (gen === generationRef.current) {
        setSwitching(false);
      }
    });
    return () => window.cancelAnimationFrame(id);
  }, [switching, enabled, options.isReady, coin]);

  return switching;
}
