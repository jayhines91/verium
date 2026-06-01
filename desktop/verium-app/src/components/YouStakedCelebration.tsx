import { PartyPopper, Trophy, X } from "lucide-react";
import { cn, formatNumber } from "@/lib/utils";

/** Stake rewards within this window get extra shimmer in the feed. */
export const FRESH_STAKED_SECONDS = 3_600;

export function isFreshStakedReward(blockTimeSec: number): boolean {
  if (!Number.isFinite(blockTimeSec) || blockTimeSec <= 0) return false;
  return Date.now() / 1000 - blockTimeSec < FRESH_STAKED_SECONDS;
}

export function youStakedRowClassName(options: {
  isYours: boolean;
  isFresh?: boolean;
  isTip?: boolean;
}): string {
  const { isYours, isFresh, isTip } = options;
  if (!isYours) {
    return cn(
      "hover:bg-bg-subtle/40",
      isTip ? "bg-accent/8" : "odd:bg-bg-subtle/25",
    );
  }
  return cn(
    "you-mined-row border-l-[3px] border-l-accent/70",
    "bg-gradient-to-r from-accent/14 via-accent/[0.06] to-transparent",
    "hover:from-accent/18 hover:via-accent/[0.08]",
    isFresh && "you-mined-row-fresh border-l-accent",
    isTip && !isFresh && "ring-1 ring-inset ring-accent/20",
  );
}

interface YouStakedBadgeProps {
  fresh?: boolean;
  className?: string;
}

export function YouStakedBadge({ fresh, className }: YouStakedBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5",
        "border-accent/35 bg-accent/10 text-[10px] font-semibold uppercase tracking-wide text-accent",
        fresh && "you-mined-badge-fresh border-accent/45 bg-accent/15",
        className,
      )}
    >
      <Trophy className="h-3 w-3 shrink-0 opacity-90" aria-hidden />
      You staked
    </span>
  );
}

interface StakeFoundBannerProps {
  height: number;
  reward: string;
  onDismiss: () => void;
}

export function StakeFoundBanner({
  height,
  reward,
  onDismiss,
}: StakeFoundBannerProps) {
  return (
    <div
      className="you-mined-banner relative mx-4 mb-3 overflow-hidden rounded-xl border border-accent/35 bg-gradient-to-br from-accent/16 via-bg-panel/90 to-bg-subtle/80 px-4 py-3.5 shadow-lg shadow-accent/10"
      role="status"
      aria-live="polite"
    >
      <div
        className="you-mined-confetti pointer-events-none absolute inset-0"
        aria-hidden
      />
      <div className="relative flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/15 ring-2 ring-accent/25">
          <Trophy className="h-5 w-5 text-accent you-mined-trophy-bounce" />
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <PartyPopper className="h-4 w-4 text-accent" aria-hidden />
            <span className="text-sm font-semibold text-fg">Stake reward!</span>
          </div>
          <p className="mt-0.5 text-sm text-fg-muted">
            You staked{" "}
            <span className="font-semibold tabular-nums text-accent">
              #{formatNumber(height)}
            </span>
            {reward !== "—" && (
              <>
                {" "}
                ·{" "}
                <span className="font-medium text-accent/90">{reward}</span>
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded-md p-1 text-fg-subtle transition-colors hover:bg-bg-panel/80 hover:text-fg"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

interface StakedRewardsSummaryProps {
  count: number;
}

export function StakedRewardsSummary({ count }: StakedRewardsSummaryProps) {
  if (count <= 0) return null;
  return null;
}
