import { MINERS_PERIODS, type MinersPeriodId } from "@/lib/miners-periods";
import { cn } from "@/lib/utils";

export function MinersPeriodPicker({
  period,
  disabled,
  onSelect,
  className,
}: {
  period: MinersPeriodId;
  disabled?: boolean;
  onSelect: (period: MinersPeriodId) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {MINERS_PERIODS.map((option) => (
        <button
          key={option.id}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(option.id)}
          className={cn(
            "rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors",
            period === option.id
              ? "border-accent/40 bg-accent/10 text-accent"
              : "border-border bg-bg-subtle/60 text-fg-muted hover:border-border/80 hover:text-fg",
            disabled && "pointer-events-none opacity-60",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
