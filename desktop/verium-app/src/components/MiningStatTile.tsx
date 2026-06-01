import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { cn } from "@/lib/utils";

export interface MiningStatTileProps {
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: string;
  icon?: LucideIcon;
  highlight?: boolean;
}

export function MiningStatTile({
  label,
  value,
  unit,
  hint,
  icon: Icon,
  highlight,
}: MiningStatTileProps) {
  return (
    <Card
      className={cn(
        highlight &&
          "border-accent/35 ring-1 ring-accent/15 shadow-[0_0_0_1px_rgb(var(--accent)/0.08)]",
      )}
    >
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium normal-case text-fg-muted">
          {Icon && <Icon className="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden />}
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="text-xl font-semibold tabular-nums sm:text-2xl">
          {value}
          {unit && (
            <span className="ml-1 text-sm font-normal text-fg-subtle">{unit}</span>
          )}
        </div>
        {hint && <p className="mt-1 text-xs text-fg-subtle">{hint}</p>}
      </CardContent>
    </Card>
  );
}
