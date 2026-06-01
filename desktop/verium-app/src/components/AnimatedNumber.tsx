import type { ReactNode } from "react";
import { animated } from "@react-spring/web";
import { useSpringNumber, type UseSpringNumberOptions } from "@/hooks/useSpringNumber";
import { cn, formatNumber } from "@/lib/utils";

export interface AnimatedNumberProps extends UseSpringNumberOptions {
  value?: number;
  fractionDigits?: number;
  className?: string;
  fallback?: ReactNode;
  /** Brief blue/red flash when the target moves up/down. */
  showTrendColor?: boolean;
  format?: (value: number, fractionDigits: number) => string;
}

/**
 * Wallet numeric display with @react-spring/web interpolation.
 */
export function AnimatedNumber({
  value,
  fractionDigits = 0,
  className,
  fallback = "—",
  showTrendColor = true,
  format = formatNumber,
  ...springOptions
}: AnimatedNumberProps) {
  const { number, trend, hasValue } = useSpringNumber(value, springOptions);

  if (!hasValue) {
    return <span className={cn("tabular-nums", className)}>{fallback}</span>;
  }

  return (
    <animated.span
      className={cn(
        "inline tabular-nums",
        showTrendColor && trend === "up" && "metric-flash-up",
        showTrendColor && trend === "down" && "metric-flash-down",
        className,
      )}
    >
      {number.to((n) => format(n, fractionDigits))}
    </animated.span>
  );
}
