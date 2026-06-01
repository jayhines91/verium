import { useSpring } from "@react-spring/web";
import { useEffect, useRef, useState } from "react";

export interface UseSpringNumberOptions {
  /** @react-spring tension (default 120). */
  tension?: number;
  /** @react-spring friction (default 14). */
  friction?: number;
  /** @react-spring mass (default 1). */
  mass?: number;
  enabled?: boolean;
  /** Skip animation and snap to target. */
  immediate?: boolean;
}

export const WALLET_NUMBER_SPRING = {
  tension: 120,
  friction: 14,
  mass: 1,
} as const;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Spring-driven number for wallet metrics (hashrate, balances, etc.).
 * Returns an animated `number` spring value and optional up/down trend.
 */
export function useSpringNumber(
  target: number | undefined,
  {
    tension = WALLET_NUMBER_SPRING.tension,
    friction = WALLET_NUMBER_SPRING.friction,
    mass = WALLET_NUMBER_SPRING.mass,
    enabled = true,
    immediate: immediateOverride,
  }: UseSpringNumberOptions = {},
) {
  const prevTarget = useRef(target);
  const [trend, setTrend] = useState<"up" | "down" | null>(null);

  const hasValue = target != null && Number.isFinite(target);
  const snap =
    immediateOverride === true ||
    !enabled ||
    prefersReducedMotion() ||
    !hasValue;

  const { number } = useSpring({
    number: hasValue ? target : 0,
    immediate: snap,
    config: { tension, friction, mass },
  });

  useEffect(() => {
    if (!hasValue) {
      setTrend(null);
      prevTarget.current = target;
      return;
    }

    if (
      prevTarget.current != null &&
      Number.isFinite(prevTarget.current) &&
      target !== prevTarget.current
    ) {
      setTrend(target > prevTarget.current ? "up" : "down");
      const id = window.setTimeout(() => setTrend(null), 700);
      prevTarget.current = target;
      return () => window.clearTimeout(id);
    }

    prevTarget.current = target;
  }, [target, hasValue]);

  return { number, trend, hasValue };
}
