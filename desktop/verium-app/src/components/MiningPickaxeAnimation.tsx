import { Pickaxe } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MiningPickaxeAnimationProps {
  active?: boolean;
  booting?: boolean;
  size?: "xs" | "sm" | "md";
  className?: string;
}

/**
 * Mining status icon — still when idle, soft glow pulse when running.
 */
export function MiningPickaxeAnimation({
  active = false,
  booting = false,
  size = "sm",
  className,
}: MiningPickaxeAnimationProps) {
  const live = active || booting;
  const iconClass =
    size === "xs" ? "h-3.5 w-3.5" : size === "md" ? "h-5 w-5" : "h-4 w-4";
  const tone = booting
    ? "text-warning"
    : active
      ? "text-success"
      : "text-fg-muted";

  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center",
        className,
      )}
      aria-hidden
    >
      {live && (
        <span
          className={cn(
            "absolute inset-0 rounded-full",
            booting
              ? "bg-warning/20 mining-glow-pulse-slow"
              : "bg-success/20 mining-glow-pulse",
          )}
        />
      )}
      <Pickaxe className={cn("relative z-10", iconClass, tone)} />
    </span>
  );
}
