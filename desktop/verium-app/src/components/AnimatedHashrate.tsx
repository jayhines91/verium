import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { cn } from "@/lib/utils";

export interface AnimatedHashrateProps {
  value?: number;
  fractionDigits?: number;
  unit?: string;
  className?: string;
  unitClassName?: string;
  booting?: boolean;
  fallback?: ReactNode;
  showTrendColor?: boolean;
  spinnerClassName?: string;
}

/**
 * Local mining hashrate with @react-spring/web digit interpolation.
 */
export function AnimatedHashrate({
  value,
  fractionDigits = 2,
  unit = "H/m",
  className,
  unitClassName,
  booting = false,
  fallback = "—",
  showTrendColor = true,
  spinnerClassName,
}: AnimatedHashrateProps) {
  if (booting) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-fg-muted",
          className,
        )}
      >
        <Loader2
          className={cn(
            "h-3.5 w-3.5 shrink-0 animate-spin text-accent",
            spinnerClassName,
          )}
          aria-hidden
        />
        Starting…
      </span>
    );
  }

  return (
    <span className="inline">
      <AnimatedNumber
        value={value}
        fractionDigits={fractionDigits}
        fallback={fallback}
        showTrendColor={showTrendColor}
        className={className}
      />
      {unit && value != null && Number.isFinite(value) ? (
        <span
          className={cn(
            "ml-1 font-normal text-fg-subtle",
            unitClassName,
          )}
        >
          {unit}
        </span>
      ) : null}
    </span>
  );
}
