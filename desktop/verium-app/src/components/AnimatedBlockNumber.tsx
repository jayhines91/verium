import { useEffect, useRef } from "react";
import { animated, useSpring } from "@react-spring/web";
import { WALLET_NUMBER_SPRING } from "@/hooks/useSpringNumber";
import { cn, formatNumber } from "@/lib/utils";

interface AnimatedBlockNumberProps {
  value?: number;
  className?: string;
  /** Animate the digits when the value increases (new chain tip). */
  animateOnIncrease?: boolean;
  /** One-shot spring (e.g. newly inserted table row). */
  forceSpring?: boolean;
  fallback?: string;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Block height with @react-spring/web when the tip advances.
 */
export function AnimatedBlockNumber({
  value,
  className,
  animateOnIncrease = true,
  forceSpring = false,
  fallback = "—",
}: AnimatedBlockNumberProps) {
  const prev = useRef<number | undefined>(undefined);

  const hasValue = value != null && Number.isFinite(value);
  const increased =
    hasValue &&
    prev.current != null &&
    value > prev.current;
  const shouldSpring =
    hasValue &&
    !prefersReducedMotion() &&
    (forceSpring || (animateOnIncrease && increased));

  const { number } = useSpring({
    number: hasValue ? value : 0,
    immediate: !shouldSpring,
    config: WALLET_NUMBER_SPRING,
  });

  useEffect(() => {
    if (hasValue) prev.current = value;
  }, [value, hasValue]);

  if (!hasValue) {
    return <span className={className}>{fallback}</span>;
  }

  return (
    <animated.span
      className={cn(
        "inline-block tabular-nums",
        shouldSpring && "animated-block-number",
        className,
      )}
    >
      {number.to((n) => formatNumber(Math.round(n)))}
    </animated.span>
  );
}
