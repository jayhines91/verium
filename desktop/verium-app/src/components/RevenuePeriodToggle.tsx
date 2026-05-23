import {
  revenuePeriodLabel,
  type RevenuePeriod,
  REVENUE_PERIODS,
} from "@/lib/mining-revenue";
import { cn } from "@/lib/utils";

interface RevenuePeriodToggleProps {
  value: RevenuePeriod;
  onChange: (period: RevenuePeriod) => void;
  className?: string;
}

export function RevenuePeriodToggle({
  value,
  onChange,
  className,
}: RevenuePeriodToggleProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Revenue period"
      className={cn(
        "inline-flex rounded-md border border-border bg-bg-subtle p-1",
        className,
      )}
    >
      {REVENUE_PERIODS.map((period) => {
        const active = value === period;
        return (
          <button
            key={period}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(period)}
            className={cn(
              "inline-flex h-8 items-center rounded px-2.5 text-xs font-medium capitalize transition-colors sm:px-3",
              active
                ? "bg-accent text-accent-fg"
                : "text-fg-muted hover:bg-bg-panel hover:text-fg",
            )}
          >
            {revenuePeriodLabel(period)}
          </button>
        );
      })}
    </div>
  );
}
