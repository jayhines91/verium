import { PartyPopper, Trophy, X } from "lucide-react";
import { getCoinProfile } from "@/lib/coin/profile";
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
}): string {
  const { isYours, isFresh } = options;
  if (!isYours) return "odd:bg-bg-subtle/30";
  return cn(
    "relative border-l-[3px] border-l-accent",
    "bg-gradient-to-r from-accent/14 via-bg-panel/40 to-transparent",
    isFresh && "you-mined-row-fresh",
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
        "border-accent/40 bg-gradient-to-r from-accent/20 via-bg-panel/80 to-accent/10",
        "text-[10px] font-bold uppercase tracking-wider text-accent shadow-sm",
        fresh && "you-mined-badge-fresh",
        className,
      )}
    >
      <Trophy className="h-3 w-3" aria-hidden />
      You staked
    </span>
  );
}

interface StakeFoundBannerProps {
  amount: string;
  onDismiss: () => void;
}

export function StakeFoundBanner({
  amount,
  onDismiss,
}: StakeFoundBannerProps) {
  return (
    <div
      className="relative mx-4 mb-3 overflow-hidden rounded-xl border border-accent/35 bg-gradient-to-br from-accent/18 via-bg-panel/90 to-bg-subtle/80 px-4 py-3.5 shadow-lg shadow-accent/10"
      role="status"
      aria-live="polite"
    >
      <div className="relative flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/15 ring-2 ring-accent/25">
          <Trophy className="h-5 w-5 text-accent" />
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <PartyPopper className="h-4 w-4 text-accent" aria-hidden />
            <span className="text-sm font-semibold text-fg">Stake reward!</span>
          </div>
          <p className="mt-0.5 text-sm text-fg-muted">
            You earned{" "}
            <span className="font-semibold text-accent">{amount}</span>
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
  totalReward: number;
  coin: "verium" | "vericoin";
}

export function StakedRewardsSummary({
  count,
  totalReward,
  coin,
}: StakedRewardsSummaryProps) {
  if (count <= 0) return null;
  const symbol = getCoinProfile(coin).symbol;

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-0.5 text-xs font-medium text-accent">
      <Trophy className="h-3 w-3" aria-hidden />
      {count} stake reward{count === 1 ? "" : "s"}
      {totalReward > 0 && (
        <span className="text-fg-muted">
          · {formatNumber(totalReward, 4)} {symbol}
        </span>
      )}
    </span>
  );
}
