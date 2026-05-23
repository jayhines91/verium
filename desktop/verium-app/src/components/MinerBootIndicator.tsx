import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";

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
  className,
  spinnerClassName,
}: {
  booting: boolean;
  value: string;
  className?: string;
  spinnerClassName?: string;
}) {
  if (!booting) {
    return <span className={className}>{value}</span>;
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-fg-muted",
        className,
      )}
    >
      <Loader2
        className={cn("h-3.5 w-3.5 animate-spin text-accent", spinnerClassName)}
      />
      Starting…
    </span>
  );
}
