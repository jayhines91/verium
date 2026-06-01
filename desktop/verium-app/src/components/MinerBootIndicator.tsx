import { Badge } from "@/components/ui/Badge";
import { AnimatedHashrate } from "@/components/AnimatedHashrate";

export function MinerBootBadge({
  booting,
  active,
  activeLabel = "Mining",
}: {
  booting: boolean;
  active: boolean;
  activeLabel?: string;
}) {
  if (booting) {
    return <Badge tone="warning">Starting…</Badge>;
  }
  if (active) {
    return <Badge tone="success">{activeLabel}</Badge>;
  }
  return null;
}

export function MinerHashrateDisplay({
  booting,
  value,
  fractionDigits = 2,
  unit,
  className,
  unitClassName,
  spinnerClassName,
  fallback,
}: {
  booting: boolean;
  /** Live H/m from `getmininginfo`; omit when booting or unknown. */
  value?: number;
  fractionDigits?: number;
  unit?: string;
  className?: string;
  unitClassName?: string;
  spinnerClassName?: string;
  fallback?: string;
}) {
  return (
    <AnimatedHashrate
      booting={booting}
      value={value}
      fractionDigits={fractionDigits}
      unit={unit}
      className={className}
      unitClassName={unitClassName}
      spinnerClassName={spinnerClassName}
      fallback={fallback ?? "—"}
    />
  );
}
