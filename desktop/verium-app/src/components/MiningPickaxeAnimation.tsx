import { cn } from "@/lib/utils";

export interface MiningPickaxeAnimationProps {
  active?: boolean;
  booting?: boolean;
  size?: "xs" | "sm" | "md";
  className?: string;
}

const sizeClass = {
  xs: "h-3.5 w-[18px]",
  sm: "h-4 w-5",
  md: "h-5 w-6",
} as const;

/**
 * Mining status icon — rock + ore with a pickaxe that swings when mining.
 */
export function MiningPickaxeAnimation({
  active = false,
  booting = false,
  size = "sm",
  className,
}: MiningPickaxeAnimationProps) {
  const live = active || booting;
  const pickaxeTone = booting
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
      <svg
        viewBox="0 0 32 26"
        fill="none"
        className={cn("overflow-visible", sizeClass[size])}
        role="img"
      >
        {/* Rock base */}
        <path
          d="M5.5 20.5C4 18.2 5.8 15.2 9 14.2C11.2 13.5 13.8 13.4 16.2 13.8C19.8 14.4 23.5 15.8 25.8 18.5C27.6 20.6 26.8 23.2 24.2 24.5C20.5 26.3 15.2 26.4 10.8 25.2C7.8 24.4 6.2 22.4 5.5 20.5Z"
          className="fill-fg-muted/25 stroke-fg-muted/35"
          strokeWidth="0.6"
        />
        {/* Ore veins in the rock */}
        <ellipse
          cx="11.5"
          cy="20.2"
          rx="2.2"
          ry="1.1"
          className="fill-warning/55"
        />
        <ellipse
          cx="17.8"
          cy="21"
          rx="1.6"
          ry="0.85"
          className="fill-warning/40"
        />
        <path
          d="M14 18.2L15.8 19.6"
          className="stroke-warning/50"
          strokeWidth="0.7"
          strokeLinecap="round"
        />

        {/* Chips flying off the strike point */}
        <g
          className={cn(live && "mining-ore-chips")}
          style={booting ? { animationDuration: "1.35s" } : undefined}
        >
          <circle cx="11" cy="19.8" r="0.55" className="fill-warning/80" />
          <circle cx="13.2" cy="20.6" r="0.4" className="fill-warning/60" />
          <path
            d="M9.8 20.8L8.6 21.6"
            className="stroke-warning/70"
            strokeWidth="0.55"
            strokeLinecap="round"
          />
        </g>

        {/* Pickaxe — pivots from the handle grip */}
        <g
          className={cn(
            pickaxeTone,
            live && (booting ? "mining-pickaxe-swing-slow" : "mining-pickaxe-swing"),
            !live && "-rotate-[22deg]",
          )}
        >
          <path
            d="M23 4L12.5 19.5"
            stroke="currentColor"
            strokeWidth="1.55"
            strokeLinecap="round"
          />
          <path
            d="M7.5 21.2L17.2 19.2"
            stroke="currentColor"
            strokeWidth="1.85"
            strokeLinecap="round"
          />
          <path
            d="M7.5 21.2L4.8 23.6"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
          />
        </g>
      </svg>
    </span>
  );
}
